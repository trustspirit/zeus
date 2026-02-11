import type { ClaudeConversation, ClaudeMessage, ContentBlock, ClaudeStreamEvent, SavedSession, PendingPrompt, SubagentInfo, QuickReply, SubagentActivityPayload } from '../types/index.js'
import { uiStore } from './ui.svelte.js'
import { skillsStore } from './skills.svelte.js'
import {
  isSubagentTool,
  isSubagentAuxTool,
  subagentAuxLabel,
  buildSubagentSummary,
  extractSubagentName,
  extractSubagentDesc,
  resolveAgentColor
} from '../utils/agent-colors.js'

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

/** Readable label for a tool name (case-insensitive lookup via lowercase keys) */
const TOOL_LABELS: Record<string, string> = {
  read: 'Reading file', write: 'Writing file', edit: 'Editing file',
  multiedit: 'Editing file', bash: 'Running command', glob: 'Finding files',
  grep: 'Searching', ls: 'Listing directory', browser: 'Browsing',
  notebookedit: 'Editing notebook', todoread: 'Reading tasks',
  todowrite: 'Updating tasks', task: 'Running subagent', delegate_task: 'Running subagent',
  taskoutput: 'Waiting for subagent', background_output: 'Waiting for subagent',
  taskcancel: 'Cancelling subagent', background_cancel: 'Cancelling subagent'
}

/** Resolve agent color using the current skill store data */
function getAgentColor(agentName: string): string {
  return resolveAgentColor(agentName, skillsStore.customSkills)
}

/**
 * Detect numbered-choice questions in the last assistant message.
 * Returns quick-reply options if the choices appear near the end of the text.
 */
function detectQuickReplies(messages: ClaudeMessage[]): QuickReply[] {
  if (messages.length === 0) return []
  const lastMsg = messages[messages.length - 1]
  if (lastMsg.role !== 'assistant') return []

  const text = lastMsg.content
  const lines = text.split('\n')

  const choiceIndices: number[] = []
  const choices: QuickReply[] = []

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(\d+)[.)]\s+(.+)$/)
    if (m) {
      choiceIndices.push(i)
      choices.push({ label: m[2].trim(), value: m[1] })
    }
  }

  if (choices.length >= 2 && choiceIndices.length >= 2) {
    const lastChoiceLine = choiceIndices[choiceIndices.length - 1]
    const trailingLines = lines.length - 1 - lastChoiceLine
    if (trailingLines <= 5) return choices
  }

  return []
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
  private _unsubSubagentActivity: (() => void) | null = null
  /** Whether the subagent file watcher is currently active */
  private _subagentWatchActive = false

  /** Start listening for Claude session events. Call once on mount. */
  listen() {
    this._unsubEvent = window.zeus.claudeSession.onEvent(({ id, event }) => {
      this._handleEvent(id, event as ClaudeStreamEvent)
    })
    this._unsubDone = window.zeus.claudeSession.onDone(({ id, exitCode, sessionId }) => {
      this._handleDone(id, exitCode, sessionId)
    })
    this._unsubSubagentActivity = window.zeus.claudeSession.onSubagentActivity((payload) => {
      this._handleSubagentActivity(payload)
    })
  }

  /** Stop listening. */
  unlisten() {
    this._unsubEvent?.()
    this._unsubDone?.()
    this._unsubSubagentActivity?.()
    this._stopSubagentWatch()
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
      pendingPrompt: null,
      activeSubagents: [],
      quickReplies: [],
      tokenUsage: null
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
      pendingPrompt: null,
      activeSubagents: [],
      quickReplies: [],
      tokenUsage: null
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
   *  If already streaming, finalize current response and send immediately (Claude Code handles --resume).
   *  @param displayContent — optional shorter text shown in the UI (e.g. skill name) while the full prompt goes to Claude */
  async send(id: string, prompt: string, displayContent?: string): Promise<void> {
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
      conv.activeSubagents = []
    }

    // Clear quick replies from previous turn
    conv.quickReplies = []

    // Add user message — store both the full prompt and the short display label
    const userMsg: ClaudeMessage = {
      id: `msg-${Date.now()}-user`,
      role: 'user',
      content: prompt,
      displayContent: displayContent || undefined,
      timestamp: Date.now()
    }

    conv.messages = [...conv.messages, userMsg]
    conv.isStreaming = true
    conv.streamingContent = ''
    conv.streamingBlocks = []
    conv.streamingStatus = 'Sending…'
    conv.tokenUsage = null

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
      conv.activeSubagents = []
      conv.quickReplies = []
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

  /** Respond to a pending prompt (permission, option selection, etc.)
   *  Primary path: writes the response to the still-open stdin (process stays alive).
   *  Fallback: if stdin is unavailable, aborts and re-spawns with --resume. */
  async respond(id: string, response: string): Promise<void> {
    const conv = this.conversations.find((c) => c.id === id)
    if (!conv?.pendingPrompt) return

    const prompt = conv.pendingPrompt
    conv.pendingPrompt = null
    conv.streamingStatus = 'Responding…'
    this.conversations = [...this.conversations]

    // Main process writes to stdin or falls back to abort+resume
    const ok = await window.zeus.claudeSession.respond(id, response)
    if (!ok) {
      conv.streamingStatus = ''
      conv.isStreaming = false
      const errMsg: ClaudeMessage = {
        id: `msg-${Date.now()}-error`,
        role: 'assistant',
        content: `⚠️ Failed to respond to prompt: ${prompt.message}`,
        timestamp: Date.now()
      }
      conv.messages = [...conv.messages, errMsg]
      this.conversations = [...this.conversations]
    }
  }

  /** Abort the currently streaming response. */
  async abort(id: string) {
    const conv = this.conversations.find((c) => c.id === id)
    if (conv?.isStreaming) {
      await window.zeus.claudeSession.abort(id)
      conv.isStreaming = false
      conv.streamingStatus = ''
      conv.pendingPrompt = null
      conv.activeSubagents = []
      this.conversations = [...this.conversations]
    }
  }

  // ── Private Event Handlers ─────────────────────────────────────────────────

  /** Format tool status with detail from input */
  private _formatToolStatus(toolName: string, input: Record<string, unknown>): string {
    const label = TOOL_LABELS[toolName.toLowerCase()] || toolName
    const detail = input.command ? String(input.command).slice(0, 60)
      : input.file_path ? String(input.file_path)
      : input.pattern ? String(input.pattern)
      : input.query ? String(input.query).slice(0, 60)
      : input.path ? String(input.path)
      : ''
    return detail ? `${label}: ${detail}` : label
  }

  /**
   * Try to extract subagent name/description from accumulated partial JSON.
   * Called on each input_json_delta for a pending subagent block.
   */
  private _tryUpdateSubagentFromPartialInput(
    conv: ClaudeConversation,
    pending: { convId: string; subagentId: string; partialJson: string }
  ): void {
    const sa = conv.activeSubagents.find((s) => s.id === pending.subagentId)
    if (!sa) return

    // Try parsing the partial JSON (adding '}' to attempt to close it)
    let parsed: Record<string, unknown> | null = null
    try {
      parsed = JSON.parse(pending.partialJson + '}')
    } catch {
      // Also try with '"}' for string fields
      try { parsed = JSON.parse(pending.partialJson + '"}') } catch { /* still partial */ }
    }
    if (!parsed) return

    // Update name if we got a better one
    const newName = extractSubagentName('task', parsed)
    if (newName && newName !== sa.name) {
      sa.name = newName
      sa.color = getAgentColor(newName)
    }
    // Update description
    const newDesc = extractSubagentDesc(parsed)
    if (newDesc && newDesc !== sa.description && newDesc !== 'Preparing…') {
      sa.description = newDesc
      sa.nestedStatus = 'Preparing…'
    }
  }

  /** Get the last unfinished subagent (avoids repeated .filter() calls in hot path) */
  private _lastRunningAgent(conv: ClaudeConversation): SubagentInfo | null {
    const agents = conv.activeSubagents
    for (let i = agents.length - 1; i >= 0; i--) {
      if (!agents[i].finished) return agents[i]
    }
    return null
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

  /**
   * Track pending subagent tool blocks by content block index.
   * Key: blockIndex, Value: { convId, subagentId, partialJson }
   * Used to accumulate input_json_delta and update subagent name/desc once parseable.
   */
  private _pendingSubagentInput = new Map<number, { convId: string; subagentId: string; partialJson: string }>()

  /** Track pending aux tool (TaskOutput etc.) to resolve task_id from streaming input */
  private _pendingAuxTool: { blockIndex: number; toolName: string; partialJson: string } | null = null

  /** Last informative status per conversation — prevents long "Processing…" stalls */
  private _lastMeaningfulStatus = new Map<string, string>()

  /**
   * Get the best available status for a conversation.
   * Falls back through: subagent summary → last meaningful status → generic.
   */
  private _bestStatus(conv: ClaudeConversation): string {
    // If subagents are running, build a summary from their activity
    if (conv.activeSubagents.length > 0) {
      const summary = buildSubagentSummary(conv.activeSubagents)
      if (summary) return summary
    }
    // Fall back to the last meaningful status we captured
    return this._lastMeaningfulStatus.get(conv.id) || 'Working…'
  }

  /**
   * Set streamingStatus — also remembers it if it's informative,
   * so we can avoid long "Processing…" stretches.
   */
  private _setStatus(conv: ClaudeConversation, status: string): void {
    conv.streamingStatus = status
    // Remember informative statuses (not vague ones)
    const vague = new Set(['Processing…', 'Working…', ''])
    if (!vague.has(status)) {
      this._lastMeaningfulStatus.set(conv.id, status)
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

      // Extract token usage from assistant message
      const msgUsage = (event.message as Record<string, unknown>).usage as Record<string, unknown> | undefined
      if (msgUsage) {
        conv.tokenUsage = {
          inputTokens: (typeof msgUsage.input_tokens === 'number' ? msgUsage.input_tokens : 0),
          outputTokens: (typeof msgUsage.output_tokens === 'number' ? msgUsage.output_tokens : 0),
          cacheReadTokens: (typeof msgUsage.cache_read_input_tokens === 'number' ? msgUsage.cache_read_input_tokens : 0),
          cacheCreateTokens: (typeof msgUsage.cache_creation_input_tokens === 'number' ? msgUsage.cache_creation_input_tokens : 0),
          totalCostUsd: conv.tokenUsage?.totalCostUsd ?? 0
        }
      }

      // Detect ALL subagent (Task) tool_use blocks — supports parallel agents
      // Use both ID and blockIndex to deduplicate (content_block_start uses cb.id,
      // snapshot uses sa-{index} — same subagent must not be added twice)
      const knownBlockIndices = new Set(conv.activeSubagents.map((s) => s.blockIndex))
      const knownIds = new Set(conv.activeSubagents.map((s) => s.id))
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i]
        if (b.type === 'tool_use' && b.name && isSubagentTool(b.name) && b.input) {
          const blockId = `sa-${i}`
          // Skip if already tracked (by either ID or block index)
          if (knownIds.has(blockId) || knownBlockIndices.has(i)) {
            // Already known subagent — update name/description if better data now available
            const existing = conv.activeSubagents.find((s) => s.id === blockId || s.blockIndex === i)
            if (existing && b.input && Object.keys(b.input).length > 0) {
              const betterName = extractSubagentName(b.name, b.input)
              if (betterName && (existing.name === b.name || existing.name === 'task' || existing.name === 'delegate_task')) {
                existing.name = betterName
                existing.color = getAgentColor(betterName)
              }
              const betterDesc = extractSubagentDesc(b.input)
              if (betterDesc && (existing.description === 'Preparing…' || !existing.description)) {
                existing.description = betterDesc
              }
            }
          } else {
            // New subagent — snapshot has full input data, so name extraction is reliable here
            const agentName = extractSubagentName(b.name, b.input)
            conv.activeSubagents = [...conv.activeSubagents, {
              id: blockId,
              blockIndex: i,
              name: agentName || b.name,
              color: getAgentColor(agentName || b.name),
              description: extractSubagentDesc(b.input) || 'Preparing…',
              nestedStatus: 'Executing…',
              toolsUsed: [],
              startedAt: Date.now(),
              finished: false
            }]
          }
          // Try to capture task_id from the immediately following tool_result
          const existing = conv.activeSubagents.find((s) => s.id === blockId || s.blockIndex === i)
          if (existing && !existing.taskId && i + 1 < blocks.length && blocks[i + 1].type === 'tool_result') {
            const resultContent = blocks[i + 1].content ?? ''
            const tidMatch = resultContent.match(/task[_-]?id["\s:]+["']?([a-f0-9]{6,12})/i)
            if (tidMatch) {
              existing.taskId = tidMatch[1]
            }
          }
        }
      }
      // Detect finished subagents: a tool_result after the last Task/aux block means agents are done
      if (conv.activeSubagents.length > 0) {
        let taskResultCount = 0
        let lastAgentBlockIdx = -1
        for (let i = 0; i < blocks.length; i++) {
          const bn = blocks[i].name
          if (blocks[i].type === 'tool_use' && bn && (isSubagentTool(bn) || isSubagentAuxTool(bn))) {
            lastAgentBlockIdx = i
          }
        }
        // Count tool_results after the last agent-related tool block
        for (let i = lastAgentBlockIdx + 1; i < blocks.length; i++) {
          if (blocks[i].type === 'tool_result') taskResultCount++
          if (blocks[i].type === 'text') taskResultCount += conv.activeSubagents.length // text after tasks = all done
        }
        if (taskResultCount >= conv.activeSubagents.length) {
          conv.activeSubagents = []
          this._stopSubagentWatch()
        }
      }

    } else if (event.type === 'content_block_start') {
      // A new content block has started (text, tool_use, thinking)
      const cb = any.content_block as Record<string, unknown> | undefined
      const blockIndex = typeof any.index === 'number' ? (any.index as number) : -1

      if (cb?.type === 'tool_use' && typeof cb.name === 'string') {
        const input = (cb.input && typeof cb.input === 'object') ? cb.input as Record<string, unknown> : {}
        const blockId = typeof cb.id === 'string' ? (cb.id as string) : `sa-${blockIndex}`

        if (isSubagentTool(cb.name)) {
          // New subagent starting — add to array (don't overwrite)
          // Note: input is usually {} here; real data arrives via input_json_delta
          // Deduplicate by both ID and blockIndex (snapshot path uses sa-{index} IDs)
          const agentName = extractSubagentName(cb.name, input)
          const alreadyExists = conv.activeSubagents.some(
            (s) => s.id === blockId || s.blockIndex === blockIndex
          )
          if (!alreadyExists) {
            conv.activeSubagents = [...conv.activeSubagents, {
              id: blockId,
              blockIndex,
              name: agentName || cb.name,
              color: getAgentColor(agentName || cb.name),
              description: extractSubagentDesc(input) || 'Preparing…',
              nestedStatus: 'Starting…',
              toolsUsed: [],
              startedAt: Date.now(),
              finished: false
            }]
            // Register for input_json_delta tracking
            this._pendingSubagentInput.set(blockIndex, { convId: id, subagentId: blockId, partialJson: '' })
          }
          this._setStatus(conv, this._formatToolStatus(cb.name, input))
        } else if (isSubagentAuxTool(cb.name)) {
          // TaskOutput / background_output / background_cancel — show as subagent status
          this._setStatus(conv, subagentAuxLabel(cb.name, input, conv.activeSubagents))
          // Track aux tool input_json_delta so we can resolve task_id once it arrives
          this._pendingAuxTool = { blockIndex, toolName: cb.name, partialJson: '' }
          // Keep any existing active subagents alive during this wait
        } else if (conv.activeSubagents.length > 0) {
          // Tool inside a subagent — update the most recently started (unfinished) agent
          const target = this._lastRunningAgent(conv)
          if (target) {
            target.nestedStatus = this._formatToolStatus(cb.name, input)
            target.nestedToolName = cb.name
            if (!target.toolsUsed.includes(cb.name)) {
              target.toolsUsed = [...target.toolsUsed, cb.name]
            }
          }
          this._setStatus(conv, this._formatToolStatus(cb.name, input))
        } else {
          this._setStatus(conv, this._formatToolStatus(cb.name, input))
        }
      } else if (cb?.type === 'thinking') {
        const target = this._lastRunningAgent(conv)
        if (target) { target.nestedStatus = 'Thinking…'; target.nestedToolName = undefined }
        this._setStatus(conv, 'Thinking…')
      } else if (cb?.type === 'text') {
        const target = this._lastRunningAgent(conv)
        if (target) { target.nestedStatus = 'Writing…'; target.nestedToolName = undefined }
        this._setStatus(conv, 'Writing…')
      }

    } else if (event.type === 'content_block_delta') {
      // Incremental delta for a content block
      const delta = any.delta as Record<string, unknown> | undefined
      const deltaIndex = typeof any.index === 'number' ? (any.index as number) : -1

      if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
        conv.streamingContent += delta.text
        // Prevent unbounded memory growth during very long streaming responses
        if (conv.streamingContent.length > MAX_STREAMING_CONTENT) {
          conv.streamingContent = conv.streamingContent.slice(-MAX_STREAMING_CONTENT)
        }
        this._setStatus(conv, 'Writing…')
      } else if (delta?.type === 'thinking_delta') {
        this._setStatus(conv, 'Thinking…')
      } else if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
        // Tool input being streamed — accumulate for pending subagent blocks
        const pending = this._pendingSubagentInput.get(deltaIndex)
        if (pending) {
          pending.partialJson += delta.partial_json
          // Try to extract subagent name/description from partial JSON
          this._tryUpdateSubagentFromPartialInput(conv, pending)
        }
        // Also accumulate for aux tools (TaskOutput etc.) to resolve task_id
        if (this._pendingAuxTool && this._pendingAuxTool.blockIndex === deltaIndex) {
          this._pendingAuxTool.partialJson += delta.partial_json
          // Try parsing to extract task_id and update status label
          try {
            const auxInput = JSON.parse(this._pendingAuxTool.partialJson) as Record<string, unknown>
            this._setStatus(conv, subagentAuxLabel(this._pendingAuxTool.toolName, auxInput, conv.activeSubagents))
            // Also try to link task_id to a subagent that doesn't have one yet
            if (typeof auxInput.task_id === 'string' && conv.activeSubagents.length > 0) {
              const tid = auxInput.task_id
              const alreadyLinked = conv.activeSubagents.some((s) => s.taskId === tid)
              if (!alreadyLinked) {
                // Assign to the first subagent without a taskId
                const unlinked = conv.activeSubagents.find((s) => !s.taskId && !s.finished)
                if (unlinked) unlinked.taskId = tid
              }
            }
          } catch {
            // Partial JSON, try a simpler extract for task_id
            const tidMatch = this._pendingAuxTool.partialJson.match(/"task_id"\s*:\s*"([a-f0-9]+)"/i)
            if (tidMatch) {
              const partialInput = { task_id: tidMatch[1], block: this._pendingAuxTool.partialJson.includes('"block":true') || this._pendingAuxTool.partialJson.includes('"block": true') }
              this._setStatus(conv, subagentAuxLabel(this._pendingAuxTool.toolName, partialInput as unknown as Record<string, unknown>, conv.activeSubagents))
            }
          }
        }
        // Avoid vague "Processing…" — show subagent activity or last known status
        if (!conv.streamingStatus) {
          conv.streamingStatus = this._bestStatus(conv)
        }
      }

    } else if (event.type === 'content_block_stop') {
      const stopIndex = typeof any.index === 'number' ? (any.index as number) : -1
      // If this was a subagent tool block, finalize input parsing and mark as executing
      const pending = this._pendingSubagentInput.get(stopIndex)
      if (pending) {
        // Final parse attempt with the complete JSON
        try {
          const fullInput = JSON.parse(pending.partialJson) as Record<string, unknown>
          const sa = conv.activeSubagents.find((s) => s.id === pending.subagentId)
          if (sa) {
            const name = extractSubagentName('task', fullInput)
            if (name) { sa.name = name; sa.color = getAgentColor(name) }
            const desc = extractSubagentDesc(fullInput)
            if (desc) sa.description = desc
            // Capture task_id if available in input
            if (typeof fullInput.task_id === 'string') sa.taskId = fullInput.task_id
            sa.nestedStatus = 'Executing…'
          }
        } catch { /* partial json, already handled incrementally */ }
        this._pendingSubagentInput.delete(stopIndex)
        // Start watching child JSONL files now that the subagent is executing
        this._maybeStartSubagentWatch(conv)
      }
      // Clear aux tool tracking when its block finishes
      if (this._pendingAuxTool && this._pendingAuxTool.blockIndex === stopIndex) {
        this._pendingAuxTool = null
      }
      // Block finished — show best available status instead of vague "Processing…"
      conv.streamingStatus = this._bestStatus(conv)

    } else if (event.type === 'result') {
      // Final result — use result text if available
      if (typeof event.result === 'string' && event.result) {
        conv.streamingContent = event.result
      }
      // Capture final usage from result event
      const resUsage = any.usage as Record<string, unknown> | undefined
      const totalCost = typeof any.total_cost_usd === 'number' ? any.total_cost_usd : 0
      if (resUsage || totalCost) {
        conv.tokenUsage = {
          inputTokens: (typeof resUsage?.input_tokens === 'number' ? resUsage.input_tokens : conv.tokenUsage?.inputTokens ?? 0),
          outputTokens: (typeof resUsage?.output_tokens === 'number' ? resUsage.output_tokens : conv.tokenUsage?.outputTokens ?? 0),
          cacheReadTokens: (typeof resUsage?.cache_read_input_tokens === 'number' ? resUsage.cache_read_input_tokens : conv.tokenUsage?.cacheReadTokens ?? 0),
          cacheCreateTokens: (typeof resUsage?.cache_creation_input_tokens === 'number' ? resUsage.cache_creation_input_tokens : conv.tokenUsage?.cacheCreateTokens ?? 0),
          totalCostUsd: totalCost || conv.tokenUsage?.totalCostUsd || 0
        }
      }
      conv.streamingStatus = ''
      conv.activeSubagents = []
      this._pendingSubagentInput.clear()
      this._pendingAuxTool = null
      this._stopSubagentWatch()

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

  // ── Subagent JSONL File Watcher ──────────────────────────────────────────────

  /** Start the JSONL file watcher if subagents are active and we have a session ID */
  private _maybeStartSubagentWatch(conv: ClaudeConversation): void {
    const activeAgents = conv.activeSubagents.filter(s => !s.finished)
    if (activeAgents.length === 0 || !conv.claudeSessionId || !conv.workspacePath) return
    // Already watching — just update targets
    if (this._subagentWatchActive) {
      window.zeus.claudeSession.updateSubagentTargets(
        activeAgents.map(s => ({ taskId: s.taskId, name: s.name, description: s.description }))
      )
      return
    }
    this._subagentWatchActive = true
    window.zeus.claudeSession.watchSubagents(
      conv.id,
      conv.claudeSessionId,
      conv.workspacePath,
      activeAgents.map(s => ({ taskId: s.taskId, name: s.name, description: s.description }))
    )
  }

  /** Stop the JSONL file watcher */
  private _stopSubagentWatch(): void {
    if (this._subagentWatchActive) {
      this._subagentWatchActive = false
      window.zeus.claudeSession.stopSubagentWatch()
    }
  }

  /** Handle activity updates from the subagent JSONL watcher */
  private _handleSubagentActivity(payload: SubagentActivityPayload): void {
    const conv = this._findConv(payload.conversationId)
    if (!conv || conv.activeSubagents.length === 0) return

    let updated = false
    for (const act of payload.activities) {
      // Try to match by name, then by taskId
      let target: SubagentInfo | undefined
      if (act.matchedName) {
        target = conv.activeSubagents.find(s => !s.finished && s.name === act.matchedName)
      }
      if (!target && act.matchedTaskId) {
        target = conv.activeSubagents.find(s => !s.finished && s.taskId === act.matchedTaskId)
      }
      // Fallback: if there's only one active subagent, it's probably that one
      if (!target) {
        const active = conv.activeSubagents.filter(s => !s.finished)
        if (active.length === 1) target = active[0]
      }

      if (target && act.latestStatus) {
        // Only update if we have something more informative than "Executing…"
        if (target.nestedStatus === 'Executing…' || target.nestedStatus === 'Starting…' ||
            target.nestedStatus === 'Working…' || act.latestStatus !== target.nestedStatus) {
          target.nestedStatus = act.latestStatus
          target.nestedToolName = act.latestTool
          if (act.latestTool && !target.toolsUsed.includes(act.latestTool)) {
            target.toolsUsed = [...target.toolsUsed, act.latestTool]
          }
          updated = true
        }
      }
    }

    if (updated) {
      // Update streamingStatus with best available info from all subagents
      const summary = buildSubagentSummary(conv.activeSubagents)
      if (summary) {
        this._setStatus(conv, summary)
      }
      this._triggerReactivity()
    }
  }

  private _handleDone(id: string, exitCode: number, sessionId?: string) {
    const conv = this._findConv(id)
    if (!conv) return

    // Stop subagent watcher when session ends
    this._stopSubagentWatch()

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
    this._lastMeaningfulStatus.delete(conv.id)

    // Detect model-level questions with numbered choices for quick-reply UI
    conv.quickReplies = detectQuickReplies(conv.messages)

    // Cap total messages to prevent unbounded growth
    if (conv.messages.length > MAX_MESSAGES) {
      conv.messages = conv.messages.slice(-MAX_MESSAGES)
    }

    // Update title from first user message if still default
    if (conv.title === 'Claude Code' && conv.messages.length >= 1) {
      const firstUser = conv.messages.find((m) => m.role === 'user')
      if (firstUser) {
        const display = firstUser.displayContent || firstUser.content
        conv.title = display.length > 30
          ? display.slice(0, 30) + '…'
          : display
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
