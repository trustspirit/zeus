import type { ClaudeConversation, ClaudeMessage, ContentBlock, ClaudeStreamEvent, SavedSession, PendingPrompt } from '../types/index.js'
import { uiStore } from './ui.svelte.js'

// ── Claude Session Store (headless -p mode) ──────────────────────────────────

let nextConvId = 1

/** Max messages kept per conversation. Oldest pairs are trimmed to stay under this limit. */
const MAX_MESSAGES = 200

/** Max size (chars) of streamingContent before we start truncating the front. */
const MAX_STREAMING_CONTENT = 100_000

/**
 * Extract text from Claude Code JSONL message content.
 * Content can be a string or an array of content blocks.
 */
function extractText(content: unknown): { text: string; blocks: ContentBlock[] } {
  const blocks: ContentBlock[] = []
  const textParts: string[] = []

  if (typeof content === 'string') {
    textParts.push(content)
    blocks.push({ type: 'text', text: content })
    return { text: content, blocks }
  }

  if (Array.isArray(content)) {
    for (const part of content) {
      if (typeof part === 'string') {
        textParts.push(part)
        blocks.push({ type: 'text', text: part })
      } else if (part && typeof part === 'object') {
        const obj = part as Record<string, unknown>
        switch (obj.type) {
          case 'text':
            if (typeof obj.text === 'string') {
              textParts.push(obj.text)
              blocks.push({ type: 'text', text: obj.text })
            }
            break
          case 'tool_use':
            blocks.push({
              type: 'tool_use',
              name: typeof obj.name === 'string' ? obj.name : 'unknown',
              input: (obj.input && typeof obj.input === 'object')
                ? obj.input as Record<string, unknown>
                : {}
            })
            break
          case 'tool_result':
            blocks.push({
              type: 'tool_result',
              content: typeof obj.content === 'string' ? obj.content : JSON.stringify(obj.content)
            })
            break
          case 'thinking':
            if (typeof obj.thinking === 'string') {
              blocks.push({ type: 'thinking', thinking: obj.thinking })
            }
            break
        }
      }
    }
  }

  return { text: textParts.join('\n'), blocks }
}

/** Readable label for a tool name (e.g. "Read" → "Reading file", "Bash" → "Running command") */
function formatToolLabel(name: string): string {
  const map: Record<string, string> = {
    Read: 'Reading file', Write: 'Writing file', Edit: 'Editing file',
    MultiEdit: 'Editing file', Bash: 'Running command', Glob: 'Finding files',
    Grep: 'Searching', LS: 'Listing directory', Browser: 'Browsing',
    NotebookEdit: 'Editing notebook', TodoRead: 'Reading tasks',
    TodoWrite: 'Updating tasks', Task: 'Running task'
  }
  return map[name] || name
}

/** Per-workspace snapshot of Claude tab state */
interface WorkspaceSnapshot {
  conversations: ClaudeConversation[]
  activeId: string | null
  savedSessions: SavedSession[]
}

class ClaudeSessionStore {
  conversations = $state<ClaudeConversation[]>([])
  activeId = $state<string | null>(null)
  /** Saved sessions for the current workspace (loaded on workspace switch) */
  savedSessions = $state<SavedSession[]>([])

  activeConversation = $derived(
    this.activeId ? this.conversations.find((c) => c.id === this.activeId) ?? null : null
  )

  /** Workspace-scoped snapshots: workspacePath → snapshot */
  private _snapshots = new Map<string, WorkspaceSnapshot>()
  private _currentWorkspace: string | null = null

  private _unsubEvent: (() => void) | null = null
  private _unsubDone: (() => void) | null = null

  /** Start listening for Claude session events. Call once on mount. */
  listen() {
    this._unsubEvent = window.zeus.claudeSession.onEvent(({ id, event }) => {
      this._handleEvent(id, event as ClaudeStreamEvent)
    })
    this._unsubDone = window.zeus.claudeSession.onDone(({ id, exitCode, sessionId }) => {
      this._handleDone(id, exitCode, sessionId)
    })
  }

  /** Stop listening. */
  unlisten() {
    this._unsubEvent?.()
    this._unsubDone?.()
  }

  /** Load saved sessions for a workspace */
  async loadSaved(workspacePath: string) {
    this.savedSessions = await window.zeus.claudeSession.listSaved(workspacePath)
  }

  /**
   * Switch workspace context: save current state, restore (or init) for the new workspace.
   * Returns true if the workspace had existing conversations restored.
   */
  switchWorkspace(workspacePath: string): boolean {
    // Save current workspace state
    if (this._currentWorkspace) {
      this._snapshots.set(this._currentWorkspace, {
        conversations: this.conversations,
        activeId: this.activeId,
        savedSessions: this.savedSessions
      })
    }

    this._currentWorkspace = workspacePath

    // Restore previous state for this workspace, or start fresh
    const snap = this._snapshots.get(workspacePath)
    if (snap) {
      this.conversations = snap.conversations
      this.activeId = snap.activeId
      this.savedSessions = snap.savedSessions
      return this.conversations.length > 0
    } else {
      this.conversations = []
      this.activeId = null
      this.savedSessions = []
      return false
    }
  }

  /** Free all resources for a workspace that was removed */
  removeWorkspace(workspacePath: string): void {
    this._snapshots.delete(workspacePath)
    // If the removed workspace is the current one, clear state
    if (this._currentWorkspace === workspacePath) {
      // Abort any streaming conversations
      for (const conv of this.conversations) {
        if (conv.isStreaming) {
          window.zeus.claudeSession.abort(conv.id).catch(() => {})
        }
        window.zeus.claudeSession.close(conv.id).catch(() => {})
      }
      this.conversations = []
      this.activeId = null
      this.savedSessions = []
      this._currentWorkspace = null
    }
  }

  /** Create a new conversation and switch to it. */
  create(workspacePath?: string): string {
    const id = `claude-${nextConvId++}`

    const conversation: ClaudeConversation = {
      id,
      claudeSessionId: null,
      title: 'Claude Code',
      workspacePath,
      messages: [],
      isStreaming: false,
      streamingContent: '',
      streamingBlocks: [],
      streamingStatus: '',
      pendingPrompt: null
    }

    this.conversations = [...this.conversations, conversation]
    this.activeId = id
    uiStore.activeView = 'claude'
    return id
  }

  /** Resume a saved session — restore transcript and activate it in-place */
  async resume(saved: SavedSession): Promise<string> {
    // Check if this session is already open
    const existing = this.conversations.find((c) => c.claudeSessionId === saved.sessionId)
    if (existing) {
      this.activeId = existing.id
      uiStore.activeView = 'claude'
      return existing.id
    }

    // Read conversation history from Claude Code's own JSONL transcript
    let restoredMessages: ClaudeMessage[] = []
    try {
      restoredMessages = await window.zeus.claudeSession.readTranscript(
        saved.sessionId,
        saved.workspacePath
      )
    } catch { /* ignore */ }

    // Fallback message if transcript is empty or not found
    if (restoredMessages.length === 0) {
      restoredMessages = [{
        id: `msg-${Date.now()}-resume`,
        role: 'assistant' as const,
        content: `Resumed session: **${saved.title}**\n\nSend a message to continue.`,
        timestamp: saved.lastUsed
      }]
    }

    // Create a new active conversation for the resumed session
    const id = `claude-${nextConvId++}`
    const conversation: ClaudeConversation = {
      id,
      claudeSessionId: saved.sessionId,
      title: saved.title,
      workspacePath: saved.workspacePath,
      messages: restoredMessages,
      isStreaming: false,
      streamingContent: '',
      streamingBlocks: [],
      streamingStatus: '',
      pendingPrompt: null
    }

    this.conversations = [...this.conversations, conversation]
    this.activeId = id
    uiStore.activeView = 'claude'

    // Remove from saved list so it transitions from History → Active in the sidebar
    this.savedSessions = this.savedSessions.filter((s) => s.sessionId !== saved.sessionId)

    return id
  }

  /** Delete a saved session from history */
  async deleteSaved(sessionId: string) {
    await window.zeus.claudeSession.deleteSaved(sessionId)
    this.savedSessions = this.savedSessions.filter((s) => s.sessionId !== sessionId)
  }

  /** Send a user message and start streaming response.
   *  If already streaming, finalize current response and send immediately (Claude Code handles --resume). */
  async send(id: string, prompt: string): Promise<void> {
    const conv = this.conversations.find((c) => c.id === id)
    if (!conv) return

    // If currently streaming, finalize the partial response before sending new message
    if (conv.isStreaming) {
      // Commit whatever was streamed so far as a partial assistant message
      if (conv.streamingContent.trim()) {
        const partialMsg: ClaudeMessage = {
          id: `msg-${Date.now()}-assistant-partial`,
          role: 'assistant',
          content: conv.streamingContent,
          blocks: conv.streamingBlocks.length > 0 ? [...conv.streamingBlocks] : undefined,
          timestamp: Date.now()
        }
        conv.messages = [...conv.messages, partialMsg]
      }
      // Abort the running process — main process kills it and fires 'done'
      await window.zeus.claudeSession.abort(id)
      conv.isStreaming = false
      conv.streamingContent = ''
      conv.streamingBlocks = []
      conv.streamingStatus = ''
      conv.pendingPrompt = null
    }

    // Add user message
    const userMsg: ClaudeMessage = {
      id: `msg-${Date.now()}-user`,
      role: 'user',
      content: prompt,
      timestamp: Date.now()
    }

    conv.messages = [...conv.messages, userMsg]
    conv.isStreaming = true
    conv.streamingContent = ''
    conv.streamingBlocks = []
    conv.streamingStatus = 'Sending…'

    // Trigger reactivity
    this.conversations = [...this.conversations]

    const cwd = conv.workspacePath || ''
    const model = uiStore.selectedModel || 'sonnet'
    // Pass claudeSessionId so main process can use --resume for continued sessions
    await window.zeus.claudeSession.send(id, prompt, cwd, model, conv.claudeSessionId ?? undefined)
  }

  /** Switch to a conversation. */
  switchTo(id: string) {
    this.activeId = id
    uiStore.activeView = 'claude'
  }

  /** Close a conversation and clean up main process session. */
  async close(id: string) {
    const conv = this.conversations.find((c) => c.id === id)
    if (conv) {
      if (conv.isStreaming) {
        await window.zeus.claudeSession.abort(id)
      }
      // Eagerly release large buffers before removing from array
      conv.messages = []
      conv.streamingContent = ''
      conv.streamingBlocks = []
      conv.streamingStatus = ''
      conv.pendingPrompt = null
    }

    // [B1] Clean up main process session entry
    await window.zeus.claudeSession.close(id)

    const idx = this.conversations.findIndex((c) => c.id === id)
    this.conversations = this.conversations.filter((c) => c.id !== id)

    if (this.activeId === id) {
      if (this.conversations.length > 0) {
        const newIdx = Math.min(idx, this.conversations.length - 1)
        this.activeId = this.conversations[newIdx].id
      } else {
        this.activeId = null
        uiStore.activeView = 'terminal'
      }
    }
  }

  /** Respond to a pending prompt (permission, option selection, etc.) */
  async respond(id: string, response: string): Promise<void> {
    const conv = this.conversations.find((c) => c.id === id)
    if (!conv?.pendingPrompt) return

    conv.pendingPrompt = null
    conv.streamingStatus = 'Processing…'
    this.conversations = [...this.conversations]

    await window.zeus.claudeSession.respond(id, response)
  }

  /** Abort the currently streaming response. */
  async abort(id: string) {
    const conv = this.conversations.find((c) => c.id === id)
    if (conv?.isStreaming) {
      await window.zeus.claudeSession.abort(id)
      conv.isStreaming = false
      conv.streamingStatus = ''
      conv.pendingPrompt = null
      this.conversations = [...this.conversations]
    }
  }

  // ── Private Event Handlers ─────────────────────────────────────────────────

  /** Format tool status with detail from input */
  private _formatToolStatus(toolName: string, input: Record<string, unknown>): string {
    const label = formatToolLabel(toolName)
    let detail = ''
    if (input.command) detail = String(input.command).slice(0, 60)
    else if (input.file_path) detail = String(input.file_path)
    else if (input.pattern) detail = String(input.pattern)
    else if (input.query) detail = String(input.query).slice(0, 60)
    else if (input.path) detail = String(input.path)
    return detail ? `${label}: ${detail}` : label
  }

  /** Update streaming status from blocks array */
  private _updateStatusFromBlocks(conv: ClaudeConversation, blocks: ContentBlock[], text: string): void {
    const lastBlock = blocks[blocks.length - 1]
    if (lastBlock?.type === 'tool_use' && lastBlock.name) {
      conv.streamingStatus = this._formatToolStatus(lastBlock.name, lastBlock.input ?? {})
    } else if (lastBlock?.type === 'thinking') {
      conv.streamingStatus = 'Thinking…'
    } else if (text) {
      conv.streamingStatus = 'Writing…'
    }
  }

  /** Throttled reactivity trigger — batch rapid streaming events into one update per frame */
  private _reactivityPending = false
  private _triggerReactivity() {
    if (this._reactivityPending) return
    this._reactivityPending = true
    requestAnimationFrame(() => {
      this._reactivityPending = false
      this.conversations = [...this.conversations]
    })
  }

  /** Find a conversation by id — check current workspace first, then snapshots */
  private _findConv(id: string): ClaudeConversation | null {
    const conv = this.conversations.find((c) => c.id === id)
    if (conv) return conv
    // Check snapshots of other workspaces
    for (const snap of this._snapshots.values()) {
      const c = snap.conversations.find((c) => c.id === id)
      if (c) return c
    }
    return null
  }

  private _handleEvent(id: string, rawEvent: ClaudeStreamEvent) {
    const conv = this._findConv(id)
    if (!conv) return

    // Unwrap stream_event wrapper if present (from --include-partial-messages)
    let event = rawEvent
    const rawAny = rawEvent as Record<string, unknown>
    if (rawEvent.type === 'stream_event' && rawAny.event && typeof rawAny.event === 'object') {
      event = rawAny.event as ClaudeStreamEvent
    }

    // Capture session_id
    const sid = event.sessionId
      || (event as Record<string, unknown>).session_id
      || rawAny.session_id
      || rawAny.sessionId
    if (typeof sid === 'string') {
      conv.claudeSessionId = sid
    }

    // Handle different event types from stream-json (with --verbose --include-partial-messages)
    // Event types: system, assistant, user, result, content_block_start, content_block_delta, content_block_stop
    const any = event as Record<string, unknown>

    if (event.type === 'assistant' && event.message?.content) {
      // Assistant message snapshot — contains full content so far
      const { text, blocks } = extractText(event.message.content)
      conv.streamingContent = text
      conv.streamingBlocks = blocks
      this._updateStatusFromBlocks(conv, blocks, text)

    } else if (event.type === 'content_block_start') {
      // A new content block has started (text, tool_use, thinking)
      const cb = any.content_block as Record<string, unknown> | undefined
      if (cb?.type === 'tool_use' && typeof cb.name === 'string') {
        const input = (cb.input && typeof cb.input === 'object') ? cb.input as Record<string, unknown> : {}
        conv.streamingStatus = this._formatToolStatus(cb.name, input)
      } else if (cb?.type === 'thinking') {
        conv.streamingStatus = 'Thinking…'
      } else if (cb?.type === 'text') {
        conv.streamingStatus = 'Writing…'
      }

    } else if (event.type === 'content_block_delta') {
      // Incremental delta for a content block
      const delta = any.delta as Record<string, unknown> | undefined
      if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
        conv.streamingContent += delta.text
        // Prevent unbounded memory growth during very long streaming responses
        if (conv.streamingContent.length > MAX_STREAMING_CONTENT) {
          conv.streamingContent = conv.streamingContent.slice(-MAX_STREAMING_CONTENT)
        }
        conv.streamingStatus = 'Writing…'
      } else if (delta?.type === 'thinking_delta') {
        conv.streamingStatus = 'Thinking…'
      } else if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
        // Tool input being streamed — update status with partial info
        conv.streamingStatus = conv.streamingStatus || 'Processing…'
      }

    } else if (event.type === 'content_block_stop') {
      // Block finished — status will be updated by next block or result
      conv.streamingStatus = 'Processing…'

    } else if (event.type === 'result') {
      // Final result — use result text if available
      if (typeof event.result === 'string' && event.result) {
        conv.streamingContent = event.result
      }
      conv.streamingStatus = ''

    } else if (event.type === 'system') {
      conv.streamingStatus = 'Initializing…'

    } else if (event.type === 'user') {
      // Tool result returned — Claude will continue processing
      conv.streamingStatus = 'Processing tool results…'

    } else if (event.type === 'raw' && typeof any.text === 'string') {
      conv.streamingContent += any.text as string
      if (conv.streamingContent.length > MAX_STREAMING_CONTENT) {
        conv.streamingContent = conv.streamingContent.slice(-MAX_STREAMING_CONTENT)
      }

    } else if (event.type === 'prompt') {
      // Claude Code is asking for user input (permission, choice, etc.)
      const promptData = any as Record<string, unknown>
      const options = (promptData.options as Array<{ label: string; value: string; key?: string }>) ?? []
      conv.pendingPrompt = {
        id: `prompt-${Date.now()}`,
        promptType: (promptData.promptType as PendingPrompt['promptType']) || 'yesno',
        message: (promptData.message as string) || (promptData.rawText as string) || 'Claude Code needs your input',
        options,
        toolName: promptData.toolName as string | undefined,
        toolInput: promptData.toolInput as string | undefined,
        rawText: promptData.rawText as string | undefined
      }
      conv.streamingStatus = 'Waiting for your response…'

    } else if (event.type === 'error' || event.type === 'stderr') {
      const errText = typeof any.text === 'string' ? (any.text as string) : ''
      // Strip ANSI escape codes for status display
      const clean = errText.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim()
      if (clean) {
        // Use stderr for status updates (Claude outputs progress here)
        conv.streamingStatus = clean.slice(0, 80)
      }
    }

    // Trigger reactivity (throttled via rAF)
    this._triggerReactivity()
  }

  private _handleDone(id: string, exitCode: number, sessionId?: string) {
    const conv = this._findConv(id)
    if (!conv) return

    if (sessionId) {
      conv.claudeSessionId = sessionId
    }

    // Finalize streaming content into a message
    if (conv.streamingContent.trim()) {
      const assistantMsg: ClaudeMessage = {
        id: `msg-${Date.now()}-assistant`,
        role: 'assistant',
        content: conv.streamingContent,
        blocks: conv.streamingBlocks.length > 0 ? [...conv.streamingBlocks] : undefined,
        timestamp: Date.now()
      }
      conv.messages = [...conv.messages, assistantMsg]
    } else if (exitCode !== 0) {
      // Error case
      const errorMsg: ClaudeMessage = {
        id: `msg-${Date.now()}-error`,
        role: 'assistant',
        content: `⚠️ Claude Code exited with code ${exitCode}`,
        timestamp: Date.now()
      }
      conv.messages = [...conv.messages, errorMsg]
    }

    conv.isStreaming = false
    conv.streamingContent = ''
    conv.streamingBlocks = []
    conv.streamingStatus = ''
    conv.pendingPrompt = null

    // Cap total messages to prevent unbounded growth
    if (conv.messages.length > MAX_MESSAGES) {
      conv.messages = conv.messages.slice(-MAX_MESSAGES)
    }

    // Update title from first user message if still default
    if (conv.title === 'Claude Code' && conv.messages.length >= 1) {
      const firstUser = conv.messages.find((m) => m.role === 'user')
      if (firstUser) {
        conv.title = firstUser.content.length > 30
          ? firstUser.content.slice(0, 30) + '…'
          : firstUser.content
      }
    }

    // Auto-save session to history for resume
    // Messages are read from Claude Code's native transcript on resume — no need to duplicate
    if (conv.claudeSessionId && conv.workspacePath) {
      window.zeus.claudeSession.save({
        sessionId: conv.claudeSessionId,
        title: conv.title,
        workspacePath: conv.workspacePath
      }).then(() => this.loadSaved(conv.workspacePath!))
    }

    // Trigger reactivity
    this.conversations = [...this.conversations]
  }
}

export const claudeSessionStore = new ClaudeSessionStore()
