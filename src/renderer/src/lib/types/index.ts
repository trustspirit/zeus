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
  isClaude: boolean
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
  name: string // command name derived from filename (without .md)
  filename: string // e.g. "refactor.md"
  filePath: string // absolute path to the .md file
  scope: 'user' | 'project' // global ~/.claude/commands vs project-level
  relativeTo: string // workspace root or parent dir where .claude/ was found
  content: string // first 200 chars for description preview
}

// ── MCP ────────────────────────────────────────────────────────────────────────
export interface MCPServer {
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  enabled: boolean
}

export interface ClaudeConfig {
  mcpServers?: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>
  permissions?: { allow?: string[]; deny?: string[] }
  [key: string]: unknown
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
  content: string
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
    update(): Promise<ClaudeUpdateResult>
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
  }
  files: {
    listMd(dirPath: string): Promise<MarkdownFile[]>
    read(filePath: string): Promise<string | null>
    write(filePath: string, content: string): Promise<boolean>
  }
  onAction(action: string, callback: () => void): () => void
}

// Augment window
declare global {
  interface Window {
    zeus: ZeusAPI
  }
}
