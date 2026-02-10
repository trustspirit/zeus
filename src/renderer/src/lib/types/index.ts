// ── Workspace ──────────────────────────────────────────────────────────────────
export interface Workspace {
  path: string
  name: string
  addedAt: number
  lastOpened: number
}

export interface DirInfo {
  name: string
  path: string
  hasGit: boolean
  hasPackageJson: boolean
  packageName: string | null
}

// ── Terminal ───────────────────────────────────────────────────────────────────
export interface TerminalSession {
  id: number
  title: string
  workspacePath: string | undefined
  history: string[]       // command history for this session
  historyIndex: number    // current position in history navigation (-1 = new input)
}

export interface TerminalSize {
  cols: number
  rows: number
}

export interface TerminalCreateResult {
  id: number
  cwd: string
}

// ── IDE ────────────────────────────────────────────────────────────────────────
export interface IDE {
  id: string
  name: string
  cmd: string
  icon: string
}

// ── Claude ─────────────────────────────────────────────────────────────────────
export interface ClaudeUpdateResult {
  success: boolean
  output?: string
  error?: string
}

// ── Skills ─────────────────────────────────────────────────────────────────────
export interface Skill {
  id: string
  name: string
  description: string
  category: 'builtin' | 'mcp' | 'custom'
  enabled: boolean
  pattern: string // permission pattern e.g. "Bash(*)" or "mcp__server__tool"
}

export interface CustomSkill {
  name: string // command name, colon-separated for nested (e.g. "workflow:deploy")
  filename: string // e.g. "deploy.md"
  filePath: string // absolute path to the .md file
  scope: 'user' | 'project' // global ~/.claude/commands vs project-level
  kind: 'command' | 'skill' | 'agent' // from .claude/commands/, .claude/skills/, or .claude/agents/
  relativeTo: string // workspace root or parent dir where .claude/ was found
  content: string // first 200 chars for description preview
  subdir: string // subdirectory within commands/ (e.g. "workflow", "skills", or "")
  /** Agent/skill color from YAML frontmatter (e.g. "purple", "cyan") */
  color?: string
  /** Description from YAML frontmatter */
  metaDescription?: string
}

// ── MCP ────────────────────────────────────────────────────────────────────────
export interface MCPServer {
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  enabled: boolean
}

export interface McpHealthEntry {
  name: string
  command: string
  transport: string
  status: 'connected' | 'failed' | 'unknown'
  error?: string
}

export interface McpServerDef {
  command: string
  args?: string[]
  env?: Record<string, string>
}

export interface ClaudeConfig {
  mcpServers?: Record<string, McpServerDef>
  /** Zeus-managed: disabled MCP servers preserved for reconnection */
  _disabledMcpServers?: Record<string, McpServerDef>
  permissions?: { allow?: string[]; deny?: string[] }
  [key: string]: unknown
}

// ── Plugins ───────────────────────────────────────────────────────────────────
export interface PluginEntry {
  name: string        // e.g. "github@claude-plugins-official"
  version: string
  scope: string       // "user" | "project" | "local"
  enabled: boolean
}

export interface MarketplaceEntry {
  name: string
  source: string
}

// ── Markdown / Docs ───────────────────────────────────────────────────────────
export interface MarkdownFile {
  name: string
  path: string
  size: number
  relativePath: string // relative to workspace root e.g. "docs/guide.md"
  dir: string // directory relative to workspace root e.g. "docs" or "."
}

export interface DocTab {
  id: string // unique tab id (= file path)
  file: MarkdownFile
  content: string | null // null when content is released from memory (inactive tab)
}

// ── Claude Conversation (headless mode) ─────────────────────────────────────
export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking'
  id?: string            // block id (tool_use blocks have a unique id from the API)
  text?: string
  name?: string          // tool name for tool_use
  input?: Record<string, unknown>
  content?: string       // for tool_result
  thinking?: string      // for thinking blocks
}

export interface ClaudeMessage {
  id: string
  role: 'user' | 'assistant'
  content: string        // display text
  blocks?: ContentBlock[]
  timestamp: number
}

/** A prompt from Claude Code that requires user interaction (permission, option selection, etc.) */
export interface PendingPrompt {
  id: string
  promptType: 'permission' | 'yesno' | 'choice' | 'input'
  message: string
  options: { label: string; value: string; key?: string }[]
  toolName?: string
  toolInput?: string
  rawText?: string
}

/** Quick-reply button for model-level questions (e.g. "1) Option A  2) Option B") */
export interface QuickReply {
  label: string   // display label (e.g. "Option A")
  value: string   // what gets sent (e.g. "1")
}

/** Active subagent (Task tool) info */
export interface SubagentInfo {
  id: string                // unique id (tool_use block id or generated)
  blockIndex: number        // content block index in the streaming message
  name: string              // agent name (e.g. "frontend-architect", "code-reviewer")
  color: string             // hex color from agent .md frontmatter or hash fallback
  description: string       // from Task input.description or prompt snippet
  nestedStatus: string      // current tool activity inside the subagent
  nestedToolName?: string   // current tool name (for icon display)
  toolsUsed: string[]       // history of tools used by this subagent
  startedAt: number
  finished: boolean         // true once tool_result received for this agent
}

export interface ClaudeConversation {
  id: string             // Zeus-internal conversation ID
  claudeSessionId: string | null  // Claude Code's session_id for --resume
  title: string
  workspacePath?: string
  messages: ClaudeMessage[]
  isStreaming: boolean
  streamingContent: string
  streamingBlocks: ContentBlock[]
  /** Real-time status line shown during streaming (e.g. "Reading file.ts…", "Running bash…") */
  streamingStatus: string
  /** Pending prompt from Claude Code waiting for user response */
  pendingPrompt: PendingPrompt | null
  /** Active subagents — supports parallel agent teams */
  activeSubagents: SubagentInfo[]
  /** Quick-reply buttons when the model asks a numbered-choice question */
  quickReplies: QuickReply[]
}

export interface ClaudeStreamEvent {
  type?: string
  message?: { role?: string; content?: unknown; model?: string }
  sessionId?: string
  result?: string
  is_error?: boolean
  costUsd?: number
  duration_ms?: number
  duration_api_ms?: number
  num_turns?: number
  [key: string]: unknown
}

// ── Saved Session (per-workspace history) ────────────────────────────────────
export interface SavedSession {
  sessionId: string
  title: string
  workspacePath: string
  lastUsed: number
}

// ── Git Diff ──────────────────────────────────────────────────────────────────
export interface GitChangedFile {
  path: string
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'unknown'
  additions: number
  deletions: number
}

// ── Store ──────────────────────────────────────────────────────────────────────
export interface AppStore {
  workspaces: Workspace[]
  lastWorkspace: string | null
  idePreference: string
  windowBounds: { x?: number; y?: number; width: number; height: number } | null
}

// ── Preload API (exposed via contextBridge) ────────────────────────────────────
export interface ZeusAPI {
  workspace: {
    list(): Promise<Workspace[]>
    add(): Promise<{ path: string; name: string } | null>
    remove(wsPath: string): Promise<boolean>
    rename(wsPath: string, newName: string): Promise<boolean>
    setLast(wsPath: string): Promise<boolean>
    getLast(): Promise<string | null>
    reorder(orderedPaths: string[]): Promise<boolean>
  }
  terminal: {
    create(workspacePath?: string): Promise<TerminalCreateResult>
    attach(termId: number, elementId: string): TerminalSize
    writeToPty(termId: number, data: string): void
    focus(termId: number): void
    fit(termId: number): TerminalSize | null
    clear(termId: number): void
    getSize(termId: number): TerminalSize | null
    kill(termId: number): Promise<boolean>
    onData(callback: (payload: { id: number; data: string }) => void): () => void
    onExit(callback: (payload: { id: number; exitCode: number }) => void): () => void
  }
  claude: {
    isInstalled(): Promise<boolean>
    version(): Promise<string | null>
    models(): Promise<{ alias: string; fullName: string; version: string }[]>
    checkLatest(): Promise<{ current: string | null; latest: string | null; upToDate: boolean }>
    update(): Promise<ClaudeUpdateResult>
  }
  claudeSession: {
    send(conversationId: string, prompt: string, cwd: string, model?: string, resumeSessionId?: string): Promise<boolean>
    abort(conversationId: string): Promise<boolean>
    respond(conversationId: string, response: string): Promise<boolean>
    close(conversationId: string): Promise<boolean>
    listSaved(workspacePath: string): Promise<SavedSession[]>
    save(session: { sessionId: string; title: string; workspacePath: string }): Promise<boolean>
    readTranscript(sessionId: string, workspacePath: string): Promise<ClaudeMessage[]>
    deleteSaved(sessionId: string): Promise<boolean>
    onEvent(callback: (payload: { id: string; event: ClaudeStreamEvent }) => void): () => void
    onDone(callback: (payload: { id: string; exitCode: number; sessionId?: string }) => void): () => void
  }
  ide: {
    list(): Promise<IDE[]>
    open(ideCmd: string, workspacePath: string): Promise<{ success: boolean; error?: string }>
    getPreference(): Promise<string>
    setPreference(ideId: string): Promise<boolean>
  }
  system: {
    openExternal(url: string): Promise<void>
    revealInFinder(filePath: string): Promise<void>
    getHome(): Promise<string>
    pathExists(p: string): Promise<boolean>
    getDirInfo(dirPath: string): Promise<DirInfo | null>
  }
  claudeConfig: {
    read(): Promise<ClaudeConfig>
    write(config: ClaudeConfig): Promise<boolean>
    readProject(wsPath: string): Promise<ClaudeConfig>
    writeProject(wsPath: string, config: ClaudeConfig): Promise<boolean>
  }
  skills: {
    scan(wsPath: string): Promise<CustomSkill[]>
  }
  mcp: {
    install(pkg: string): Promise<{ success: boolean; output?: string; error?: string }>
    health(): Promise<McpHealthEntry[]>
  }
  plugin: {
    list(): Promise<PluginEntry[]>
    marketplaceList(): Promise<MarketplaceEntry[]>
    install(name: string, scope?: string): Promise<{ success: boolean; output?: string; error?: string }>
    uninstall(name: string): Promise<{ success: boolean; output?: string; error?: string }>
    enable(name: string, scope?: string): Promise<{ success: boolean; output?: string; error?: string }>
    disable(name: string, scope?: string): Promise<{ success: boolean; output?: string; error?: string }>
    marketplaceAdd(source: string): Promise<{ success: boolean; output?: string; error?: string }>
  }
  files: {
    listMd(dirPath: string): Promise<MarkdownFile[]>
    read(filePath: string): Promise<string | null>
    write(filePath: string, content: string): Promise<boolean>
  }
  git: {
    diff(workspacePath: string): Promise<string>
    diffFile(workspacePath: string, filePath: string): Promise<string>
    changedFiles(workspacePath: string): Promise<GitChangedFile[]>
  }
  onAction(action: string, callback: () => void): () => void
}

// Augment window
declare global {
  interface Window {
    zeus: ZeusAPI
  }
}
