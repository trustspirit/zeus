import type { ClaudeConversation, ClaudeMessage, ContentBlock, ClaudeStreamEvent, SavedSession } from '../types/index.js'
import { uiStore } from './ui.svelte.js'

// ── Claude Session Store (headless -p mode) ──────────────────────────────────

let nextConvId = 1

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

class ClaudeSessionStore {
  conversations = $state<ClaudeConversation[]>([])
  activeId = $state<string | null>(null)
  /** Saved sessions for the current workspace (loaded on workspace switch) */
  savedSessions = $state<SavedSession[]>([])

  activeConversation = $derived(
    this.activeId ? this.conversations.find((c) => c.id === this.activeId) ?? null : null
  )

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
      streamingBlocks: []
    }

    this.conversations = [...this.conversations, conversation]
    this.activeId = id
    uiStore.activeView = 'claude'
    return id
  }

  /** Resume a saved session — creates a conversation with the existing sessionId */
  resume(saved: SavedSession): string {
    // Check if already open
    const existing = this.conversations.find((c) => c.claudeSessionId === saved.sessionId)
    if (existing) {
      this.activeId = existing.id
      uiStore.activeView = 'claude'
      return existing.id
    }

    const id = `claude-${nextConvId++}`

    // Add a system-like message so the user sees the session was restored
    const resumeMsg: ClaudeMessage = {
      id: `msg-${Date.now()}-resume`,
      role: 'assistant',
      content: `Resumed session: **${saved.title}**\n\nThis conversation will continue from where you left off. Send a message to pick up.`,
      timestamp: saved.lastUsed
    }

    const conversation: ClaudeConversation = {
      id,
      claudeSessionId: saved.sessionId,
      title: saved.title,
      workspacePath: saved.workspacePath,
      messages: [resumeMsg],
      isStreaming: false,
      streamingContent: '',
      streamingBlocks: []
    }

    this.conversations = [...this.conversations, conversation]
    this.activeId = id
    uiStore.activeView = 'claude'
    return id
  }

  /** Delete a saved session from history */
  async deleteSaved(sessionId: string) {
    await window.zeus.claudeSession.deleteSaved(sessionId)
    this.savedSessions = this.savedSessions.filter((s) => s.sessionId !== sessionId)
  }

  /** Send a user message and start streaming response. */
  async send(id: string, prompt: string): Promise<void> {
    const conv = this.conversations.find((c) => c.id === id)
    if (!conv) return

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
    if (conv?.isStreaming) {
      await window.zeus.claudeSession.abort(id)
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

  /** Abort the currently streaming response. */
  async abort(id: string) {
    const conv = this.conversations.find((c) => c.id === id)
    if (conv?.isStreaming) {
      await window.zeus.claudeSession.abort(id)
      conv.isStreaming = false
      this.conversations = [...this.conversations]
    }
  }

  // ── Private Event Handlers ─────────────────────────────────────────────────

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

  private _handleEvent(id: string, event: ClaudeStreamEvent) {
    const conv = this.conversations.find((c) => c.id === id)
    if (!conv) return

    // Capture session_id
    const sid = event.sessionId || (event as Record<string, unknown>).session_id
    if (typeof sid === 'string') {
      conv.claudeSessionId = sid
    }

    // Handle different event types from stream-json
    // See: https://code.claude.com/docs/en/headless
    // Event types: system, assistant, user, result
    if (event.type === 'assistant' && event.message?.content) {
      // Assistant message snapshot — contains full content so far
      const { text, blocks } = extractText(event.message.content)
      conv.streamingContent = text
      conv.streamingBlocks = blocks
    } else if (event.type === 'result') {
      // Final result — use result text if available
      if (typeof event.result === 'string' && event.result) {
        conv.streamingContent = event.result
      }
    } else if (event.type === 'system') {
      // Session init event — nothing to display but captures session_id above
    } else if (event.type === 'user') {
      // Tool result event — could display tool outputs if needed
    } else if (event.type === 'raw' && typeof (event as Record<string, unknown>).text === 'string') {
      // Non-JSON output from claude
      conv.streamingContent += (event as Record<string, unknown>).text as string
    } else if (event.type === 'error' || event.type === 'stderr') {
      const errText = typeof (event as Record<string, unknown>).text === 'string'
        ? (event as Record<string, unknown>).text as string
        : ''
      // Only show real errors, not progress/spinner output
      if (errText && !errText.includes('\x1b[') && !errText.includes('Thinking')) {
        conv.streamingContent += `\n⚠️ ${errText}`
      }
    }

    // Trigger reactivity (throttled via rAF)
    this._triggerReactivity()
  }

  private _handleDone(id: string, exitCode: number, sessionId?: string) {
    const conv = this.conversations.find((c) => c.id === id)
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
