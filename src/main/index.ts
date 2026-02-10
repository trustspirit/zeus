import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Menu,
  shell,
  type MenuItemConstructorOptions
} from 'electron'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { execSync, spawn } from 'node:child_process'
import type * as PtyModule from 'node-pty'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Workspace {
  path: string
  name: string
  addedAt: number
  lastOpened: number
}

interface SavedSession {
  sessionId: string
  title: string
  workspacePath: string
  lastUsed: number
}

interface AppStore {
  workspaces: Workspace[]
  lastWorkspace: string | null
  idePreference: string
  windowBounds: { x?: number; y?: number; width: number; height: number } | null
  savedSessions?: SavedSession[]
}

interface IDEDef {
  id: string
  name: string
  cmd: string
  icon: string
}

interface TermEntry {
  pty: PtyModule.IPty
  workspace: string
}

interface ClaudeSessionEntry {
  process: ReturnType<typeof spawn> | null
  sessionId: string | null
  cwd: string
}

// ── State ──────────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null
let pty: typeof PtyModule
const terminals = new Map<number, TermEntry>()
let nextTermId = 1
let store: AppStore

// ── Claude Sessions (headless -p mode) ────────────────────────────────────────
const claudeSessions = new Map<string, ClaudeSessionEntry>()

// ── Paths ──────────────────────────────────────────────────────────────────────

const storeFilePath = path.join(app.getPath('userData'), 'zeus-store.json')

// ── Store I/O ──────────────────────────────────────────────────────────────────

function loadStore(): AppStore {
  try {
    if (fs.existsSync(storeFilePath)) {
      return JSON.parse(fs.readFileSync(storeFilePath, 'utf-8'))
    }
  } catch {
    /* corrupted store — reset */
  }
  return { workspaces: [], lastWorkspace: null, idePreference: 'code', windowBounds: null }
}

function saveStore(data: AppStore): void {
  try {
    fs.mkdirSync(path.dirname(storeFilePath), { recursive: true })
    fs.writeFileSync(storeFilePath, JSON.stringify(data, null, 2), 'utf-8')
  } catch (e) {
    console.error('[zeus] Failed to save store:', e)
  }
}

// ── IDE Detection ──────────────────────────────────────────────────────────────

const IDE_LIST: IDEDef[] = [
  { id: 'code', name: 'VS Code', cmd: 'code', icon: 'vscode' },
  { id: 'cursor', name: 'Cursor', cmd: 'cursor', icon: 'cursor' },
  { id: 'antigravity', name: 'Anti-Gravities', cmd: 'antigravity', icon: 'antigravity' },
  { id: 'windsurf', name: 'Windsurf', cmd: 'windsurf', icon: 'windsurf' },
  { id: 'zed', name: 'Zed', cmd: 'zed', icon: 'zed' },
  { id: 'idea', name: 'IntelliJ IDEA', cmd: 'idea', icon: 'idea' },
  { id: 'webstorm', name: 'WebStorm', cmd: 'webstorm', icon: 'webstorm' },
  { id: 'sublime', name: 'Sublime Text', cmd: 'subl', icon: 'sublime' },
  { id: 'vim', name: 'Neovim', cmd: 'nvim', icon: 'vim' }
]

function whichSync(cmd: string): boolean {
  try {
    const whichCmd = process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`
    const result = execSync(whichCmd, {
      encoding: 'utf-8',
      timeout: 3000,
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim()
    return result.length > 0
  } catch {
    return false
  }
}

function detectInstalledIDEs(): IDEDef[] {
  return IDE_LIST.filter((ide) => whichSync(ide.cmd))
}

// ── Claude Code ────────────────────────────────────────────────────────────────

function isClaudeCodeInstalled(): boolean {
  return whichSync('claude')
}

function getClaudeCodeVersion(): string | null {
  try {
    return execSync('claude --version', {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim()
  } catch {
    return null
  }
}

function checkLatestClaudeVersion(): Promise<{ current: string | null; latest: string | null; upToDate: boolean }> {
  return new Promise((resolve) => {
    const current = getClaudeCodeVersion()
    // Extract semver from version string (e.g. "claude 1.0.25 (Claude Code)" → "1.0.25")
    const currentSemver = current?.match(/(\d+\.\d+\.\d+)/)?.[1] ?? null

    const child = spawn('npm', ['view', '@anthropic-ai/claude-code', 'version'], {
      shell: true,
      env: { ...process.env },
      timeout: 15000
    })

    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (d: Buffer) => (stdout += d.toString()))
    child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()))

    child.on('close', (code) => {
      const latest = stdout.trim() || null
      if (code !== 0 || !latest) {
        resolve({ current: currentSemver, latest: null, upToDate: false })
        return
      }
      const upToDate = currentSemver === latest
      resolve({ current: currentSemver, latest, upToDate })
    })

    child.on('error', () => {
      resolve({ current: currentSemver, latest: null, upToDate: false })
    })
  })
}

function updateClaudeCode(): Promise<{ success: boolean; output?: string; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn('npm', ['install', '-g', '@anthropic-ai/claude-code'], {
      shell: true,
      env: { ...process.env }
    })

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (d: Buffer) => (stdout += d.toString()))
    child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()))

    child.on('close', (code) => {
      if (code === 0) resolve({ success: true, output: stdout })
      else resolve({ success: false, error: stderr || `Exit code ${code}` })
    })

    child.on('error', (err) => {
      resolve({ success: false, error: err.message })
    })
  })
}

// ── Terminal (PTY) ─────────────────────────────────────────────────────────────

function getShell(): string {
  if (process.platform === 'win32') return 'powershell.exe'
  return process.env.SHELL || '/bin/zsh'
}

function createTerminal(workspacePath?: string): { id: number; cwd: string } {
  const id = nextTermId++
  const cwd =
    workspacePath && fs.existsSync(workspacePath) ? workspacePath : os.homedir()

  const shell = getShell()

  // Spawn as login shell so .zshrc / .bash_profile are sourced (colors, aliases, PATH)
  const shellArgs: string[] = process.platform === 'win32' ? [] : ['--login']

  const ptyProcess = pty.spawn(shell, shellArgs, {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'Zeus',
      LANG: process.env.LANG || 'en_US.UTF-8'
    }
  })

  terminals.set(id, { pty: ptyProcess, workspace: cwd })

  ptyProcess.onData((data) => {
    mainWindow?.webContents.send('terminal:data', { id, data })
  })

  ptyProcess.onExit(({ exitCode }) => {
    terminals.delete(id)
    mainWindow?.webContents.send('terminal:exit', { id, exitCode })
  })

  return { id, cwd }
}

// ── Window ─────────────────────────────────────────────────────────────────────

function createWindow(): void {
  const bounds = store.windowBounds

  mainWindow = new BrowserWindow({
    width: bounds?.width ?? 1400,
    height: bounds?.height ?? 900,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0d0d0d',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    vibrancy: 'under-window',
    visualEffectState: 'active',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    },
    show: false
  })

  // Dev or production loading
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('close', () => {
    if (mainWindow) {
      store.windowBounds = mainWindow.getBounds()
      saveStore(store)
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  buildMenu()
}

// ── Menu ───────────────────────────────────────────────────────────────────────

function buildMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Terminal',
      submenu: [
        {
          label: 'New Terminal',
          accelerator: 'CmdOrCtrl+T',
          click: () => mainWindow?.webContents.send('action:new-terminal')
        },
        {
          label: 'Run Claude Code',
          accelerator: 'CmdOrCtrl+Shift+C',
          click: () => mainWindow?.webContents.send('action:run-claude')
        },
        { type: 'separator' },
        {
          label: 'Clear Terminal',
          accelerator: 'CmdOrCtrl+K',
          click: () => mainWindow?.webContents.send('action:clear-terminal')
        }
      ]
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ── IPC ────────────────────────────────────────────────────────────────────────

function registerIPC(): void {
  // Workspace
  ipcMain.handle('workspace:list', () => store.workspaces)

  ipcMain.handle('workspace:add', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Choose Workspace Directory'
    })
    if (result.canceled || result.filePaths.length === 0) return null

    const dirPath = result.filePaths[0]
    const name = path.basename(dirPath)

    if (!store.workspaces.find((w) => w.path === dirPath)) {
      store.workspaces.push({ path: dirPath, name, addedAt: Date.now(), lastOpened: Date.now() })
      saveStore(store)
    }
    return { path: dirPath, name }
  })

  ipcMain.handle('workspace:remove', (_, wsPath: string) => {
    store.workspaces = store.workspaces.filter((w) => w.path !== wsPath)
    saveStore(store)
    return true
  })

  ipcMain.handle('workspace:set-last', (_, wsPath: string) => {
    store.lastWorkspace = wsPath
    const ws = store.workspaces.find((w) => w.path === wsPath)
    if (ws) ws.lastOpened = Date.now()
    saveStore(store)
    return true
  })

  ipcMain.handle('workspace:get-last', () => store.lastWorkspace)

  ipcMain.handle('workspace:reorder', (_, orderedPaths: string[]) => {
    // Rebuild workspaces array in the given path order
    const byPath = new Map(store.workspaces.map((w) => [w.path, w]))
    const reordered: Workspace[] = []
    for (const p of orderedPaths) {
      const ws = byPath.get(p)
      if (ws) reordered.push(ws)
    }
    // Append any missing (shouldn't happen, but be safe)
    for (const ws of store.workspaces) {
      if (!reordered.find((r) => r.path === ws.path)) reordered.push(ws)
    }
    store.workspaces = reordered
    saveStore(store)
    return true
  })

  // Terminal
  ipcMain.handle('terminal:create', (_, workspacePath?: string) => createTerminal(workspacePath))

  ipcMain.on('terminal:write', (_, { id, data }: { id: number; data: string }) => {
    terminals.get(id)?.pty.write(data)
  })

  ipcMain.on('terminal:resize', (_, { id, cols, rows }: { id: number; cols: number; rows: number }) => {
    try {
      terminals.get(id)?.pty.resize(cols, rows)
    } catch (e) {
      // [R1] PTY may already be gone — ignore resize errors
      console.warn(`[zeus] terminal:resize failed for id=${id}:`, e)
    }
  })

  ipcMain.handle('terminal:kill', (_, id: number) => {
    const t = terminals.get(id)
    if (t) {
      t.pty.kill()
      terminals.delete(id)
    }
    return true
  })

  // Claude
  ipcMain.handle('claude:is-installed', () => isClaudeCodeInstalled())
  ipcMain.handle('claude:version', () => getClaudeCodeVersion())
  ipcMain.handle('claude:check-latest', () => checkLatestClaudeVersion())
  ipcMain.handle('claude:update', () => updateClaudeCode())

  // IDE
  ipcMain.handle('ide:list', () => detectInstalledIDEs())

  ipcMain.handle('ide:open', (_, { ideCmd, workspacePath }: { ideCmd: string; workspacePath: string }) => {
    // [S3] Only allow commands from our known IDE list to prevent arbitrary execution
    const allowedCmds = new Set(IDE_LIST.map((ide) => ide.cmd))
    if (!allowedCmds.has(ideCmd)) {
      return { success: false, error: `Unknown IDE command: ${ideCmd}` }
    }
    try {
      const child = spawn(ideCmd, [workspacePath], { detached: true, stdio: 'ignore', shell: true })
      child.unref()
      return { success: true }
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('ide:get-preference', () => store.idePreference)
  ipcMain.handle('ide:set-preference', (_, ideId: string) => {
    store.idePreference = ideId
    saveStore(store)
    return true
  })

  // System
  ipcMain.handle('system:open-external', (_, url: string) => shell.openExternal(url))
  ipcMain.handle('system:reveal-in-finder', (_, p: string) => shell.showItemInFolder(p))
  ipcMain.handle('system:get-home', () => os.homedir())
  ipcMain.handle('system:path-exists', (_, p: string) => fs.existsSync(p))

  ipcMain.handle('system:get-dir-info', (_, dirPath: string) => {
    try {
      if (!fs.statSync(dirPath).isDirectory()) return null
      const hasGit = fs.existsSync(path.join(dirPath, '.git'))
      const hasPackageJson = fs.existsSync(path.join(dirPath, 'package.json'))
      let packageName: string | null = null
      if (hasPackageJson) {
        try {
          packageName = JSON.parse(fs.readFileSync(path.join(dirPath, 'package.json'), 'utf-8')).name
        } catch { /* ignore */ }
      }
      return { name: path.basename(dirPath), path: dirPath, hasGit, hasPackageJson, packageName }
    } catch {
      return null
    }
  })

  // ── Claude Config / Skills / MCP ──

  ipcMain.handle('claude-config:read', () => readClaudeConfig())
  ipcMain.handle('claude-config:write', (_, config: object) => writeClaudeConfig(config))
  ipcMain.handle('claude-config:read-project', (_, wsPath: string) => readProjectClaudeConfig(wsPath))
  ipcMain.handle('claude-config:write-project', (_, wsPath: string, config: object) =>
    writeProjectClaudeConfig(wsPath, config)
  )

  // MCP
  ipcMain.handle('mcp:install', (_, pkg: string) => installMCPPackage(pkg))

  // Skills — scan .claude/commands/ recursively
  ipcMain.handle('skills:scan', (_, wsPath: string) => scanCustomSkills(wsPath))

  // Files / Markdown
  ipcMain.handle('files:list-md', (_, dirPath: string) => listMarkdownFiles(dirPath))
  ipcMain.handle('files:read', (_, filePath: string) => readFileContent(filePath))
  ipcMain.handle('files:write', (_, filePath: string, content: string) => writeFileContent(filePath, content))

  // ── Saved Claude Sessions (per-workspace history) ──
  ipcMain.handle('claude-session:list-saved', (_, workspacePath: string) => {
    const sessions = store.savedSessions ?? []
    return sessions
      .filter((s) => s.workspacePath === workspacePath)
      .sort((a, b) => b.lastUsed - a.lastUsed)
  })

  ipcMain.handle('claude-session:save', (_, session: { sessionId: string; title: string; workspacePath: string }) => {
    if (!store.savedSessions) store.savedSessions = []
    const existing = store.savedSessions.find((s) => s.sessionId === session.sessionId)

    if (existing) {
      existing.title = session.title
      existing.lastUsed = Date.now()
    } else {
      store.savedSessions.push({ ...session, lastUsed: Date.now() })
    }
    // Keep max 50 sessions per workspace
    const byWs = store.savedSessions.filter((s) => s.workspacePath === session.workspacePath)
    if (byWs.length > 50) {
      const oldest = byWs.sort((a, b) => a.lastUsed - b.lastUsed)[0]
      store.savedSessions = store.savedSessions.filter((s) => s.sessionId !== oldest.sessionId)
    }
    saveStore(store)
    return true
  })

  ipcMain.handle('claude-session:delete-saved', (_, sessionId: string) => {
    if (!store.savedSessions) return true
    store.savedSessions = store.savedSessions.filter((s) => s.sessionId !== sessionId)
    saveStore(store)
    return true
  })

  // ── Read Claude Code's native session transcript ──
  ipcMain.handle('claude-session:read-transcript', (_, sessionId: string, workspacePath: string) => {
    return readClaudeTranscript(sessionId, workspacePath)
  })

  // ── Claude Session (headless -p mode with stream-json) ──
  ipcMain.handle(
    'claude-session:send',
    (_, conversationId: string, prompt: string, cwd: string, model?: string, resumeSessionId?: string) => {
      return spawnClaudeSession(conversationId, prompt, cwd, model, resumeSessionId)
    }
  )

  ipcMain.handle('claude-session:abort', (_, conversationId: string) => {
    const session = claudeSessions.get(conversationId)
    if (session?.process) {
      session.process.kill('SIGINT')
    }
    return true
  })

  // [B1] Clean up session entry when conversation is closed from renderer
  ipcMain.handle('claude-session:close', (_, conversationId: string) => {
    const session = claudeSessions.get(conversationId)
    if (session?.process) {
      try { session.process.kill('SIGINT') } catch { /* ignore */ }
    }
    claudeSessions.delete(conversationId)
    return true
  })
}

// ── Claude Config Helpers ──────────────────────────────────────────────────────

function getClaudeConfigPath(): string {
  return path.join(os.homedir(), '.claude.json')
}

function readClaudeConfig(): object {
  try {
    const p = getClaudeConfigPath()
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf-8'))
    }
  } catch { /* ignore */ }
  return {}
}

function writeClaudeConfig(config: object): boolean {
  try {
    fs.writeFileSync(getClaudeConfigPath(), JSON.stringify(config, null, 2), 'utf-8')
    return true
  } catch {
    return false
  }
}

function readProjectClaudeConfig(wsPath: string): object {
  try {
    const p = path.join(wsPath, '.claude', 'settings.json')
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf-8'))
    }
  } catch { /* ignore */ }
  return {}
}

function writeProjectClaudeConfig(wsPath: string, config: object): boolean {
  try {
    const dir = path.join(wsPath, '.claude')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(config, null, 2), 'utf-8')
    return true
  } catch {
    return false
  }
}

function installMCPPackage(pkg: string): Promise<{ success: boolean; output?: string; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn('npm', ['install', '-g', pkg], { shell: true, env: { ...process.env } })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (d: Buffer) => (stdout += d.toString()))
    child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()))
    child.on('close', (code) => {
      if (code === 0) resolve({ success: true, output: stdout })
      else resolve({ success: false, error: stderr || `Exit code ${code}` })
    })
    child.on('error', (err) => resolve({ success: false, error: err.message }))
  })
}

// ── Shared constants ──────────────────────────────────────────────────────────

// [A3] Consolidated skip list — used by both skills scanner and markdown scanner
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out',
  '.next', '.nuxt', '.output', '__pycache__', 'venv', '.venv',
  'target', 'vendor', '.idea', '.vscode', 'coverage', '.cache', '.turbo'
])

// ── Custom Skills Scanner ─────────────────────────────────────────────────────

type SkillKind = 'command' | 'skill' | 'agent'

interface CustomSkillEntry {
  name: string // command name derived from path (without .md), colon-separated for nested
  filename: string // e.g. "refactor.md"
  filePath: string // absolute path to the .md file
  scope: 'user' | 'project' // global ~/.claude/commands vs project .claude/commands
  kind: SkillKind // which .claude/ subdirectory it came from
  relativeTo: string // workspace root or parent dir where .claude/ was found
  content: string // first 200 chars for description preview
  subdir: string // subdirectory within commands/ (e.g. "workflow", "skills", or "")
}

/** The three .claude/ subdirectories we scan for skills */
const SKILL_DIRS: { dir: string; kind: SkillKind }[] = [
  { dir: 'commands', kind: 'command' },
  { dir: 'skills', kind: 'skill' },
  { dir: 'agents', kind: 'agent' }
]

/**
 * Scan for custom skills (.md files) from:
 * 1. Global: ~/.claude/{commands,skills,agents}/
 * 2. Project root: <wsPath>/.claude/{commands,skills,agents}/
 * 3. Child directories (depth-limited): <wsPath>/<child>/.claude/{commands,skills,agents}/
 */
function scanCustomSkills(wsPath: string): CustomSkillEntry[] {
  const results: CustomSkillEntry[] = []

  // 1. Global user commands/skills/agents (always)
  for (const { dir, kind } of SKILL_DIRS) {
    const globalDir = path.join(os.homedir(), '.claude', dir)
    collectCommandFiles(globalDir, 'user', kind, os.homedir(), results)
  }

  // 2 & 3: Only if workspace path is provided
  if (wsPath && fs.existsSync(wsPath)) {
    // 2. Project root
    for (const { dir, kind } of SKILL_DIRS) {
      const projectDir = path.join(wsPath, '.claude', dir)
      collectCommandFiles(projectDir, 'project', kind, wsPath, results)
    }

    // 3. Recurse into child directories (depth-limited)
    scanChildrenForCommands(wsPath, results, 0)
  }

  return results
}

/**
 * Recursively collect .md files from a commands/ directory.
 * Subdirectories become colon-separated command prefixes:
 *   commands/foo.md           → name = "foo"
 *   commands/workflow/bar.md  → name = "workflow:bar"
 *   commands/skills/dev/x.md  → name = "skills:dev:x"
 */
function collectCommandFiles(
  cmdsDir: string,
  scope: 'user' | 'project',
  kind: SkillKind,
  relativeTo: string,
  results: CustomSkillEntry[]
): void {
  collectCommandFilesRecursive(cmdsDir, cmdsDir, scope, kind, relativeTo, results, 0)
}

function collectCommandFilesRecursive(
  baseDir: string,
  currentDir: string,
  scope: 'user' | 'project',
  kind: SkillKind,
  relativeTo: string,
  results: CustomSkillEntry[],
  depth: number
): void {
  if (depth > 5) return // safety limit
  try {
    if (!fs.existsSync(currentDir) || !fs.statSync(currentDir).isDirectory()) return
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name)

      if (entry.isFile() && /\.md$/i.test(entry.name)) {
        // Avoid duplicates
        if (results.some((r) => r.filePath === fullPath)) continue

        // Build colon-separated name from relative path within the base dir
        const relFromBase = path.relative(baseDir, fullPath)
        const nameWithoutExt = relFromBase.replace(/\.md$/i, '')
        const colonName = nameWithoutExt.split(path.sep).join(':')

        // Subdirectory label (folder within base dir, empty for top-level)
        const dirParts = nameWithoutExt.split(path.sep)
        const subdir = dirParts.length > 1 ? dirParts.slice(0, -1).join('/') : ''

        try {
          const raw = fs.readFileSync(fullPath, 'utf-8')
          results.push({
            name: colonName,
            filename: entry.name,
            filePath: fullPath,
            scope,
            kind,
            relativeTo,
            content: raw.slice(0, 200),
            subdir
          })
        } catch { /* unreadable file */ }
      } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
        // Recurse into subdirectories
        collectCommandFilesRecursive(baseDir, fullPath, scope, kind, relativeTo, results, depth + 1)
      }
    }
  } catch { /* directory access error */ }
}

/**
 * Recursively scan child directories for .claude/commands/ folders.
 * depth=0 means direct children of wsPath.
 * Limited to depth 3 and skips common heavy dirs.
 */
function scanChildrenForCommands(
  dir: string,
  results: CustomSkillEntry[],
  depth: number
): void {
  if (depth > 3) return
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.') && entry.name !== '.claude') continue
      if (SKIP_DIRS.has(entry.name)) continue

      const childPath = path.join(dir, entry.name)

      // Check if this child has .claude/{commands,skills,agents}/
      for (const { dir: subDir, kind } of SKILL_DIRS) {
        const cmdsDir = path.join(childPath, '.claude', subDir)
        if (fs.existsSync(cmdsDir)) {
          collectCommandFiles(cmdsDir, 'project', kind, childPath, results)
        }
      }

      // Recurse deeper
      scanChildrenForCommands(childPath, results, depth + 1)
    }
  } catch { /* permission error */ }
}

// ── File Helpers ───────────────────────────────────────────────────────────────

interface MdFileEntry {
  name: string
  path: string
  size: number
  relativePath: string
  dir: string
}

/**
 * List only Claude Code related .md files:
 *   - .claude/ directories (commands, skills, agents, docs, etc.)
 *   - Also CLAUDE.md / AGENTS.md / agent.md at project roots
 * Scans workspace root and child directories.
 */
function listMarkdownFiles(dirPath: string): MdFileEntry[] {
  const results: MdFileEntry[] = []
  if (!dirPath || !fs.existsSync(dirPath)) return results

  try {
    // 1. Collect root-level Claude-related .md files (CLAUDE.md, AGENTS.md, agent.md, etc.)
    collectClaudeRootMd(dirPath, dirPath, results)

    // 2. Scan .claude/ directory at workspace root
    const rootClaudeDir = path.join(dirPath, '.claude')
    if (fs.existsSync(rootClaudeDir)) {
      collectAllMdInDir(rootClaudeDir, dirPath, results, 0)
    }

    // 3. Scan child directories for their .claude/ dirs
    scanChildrenForClaudeMd(dirPath, dirPath, results, 0)
  } catch { /* ignore */ }

  return results.sort((a, b) => {
    if (a.dir !== b.dir) return a.dir.localeCompare(b.dir)
    return a.name.localeCompare(b.name)
  })
}

/** Filenames at project root that are Claude Code related */
const CLAUDE_ROOT_FILES = new Set([
  'claude.md', 'agents.md', 'agent.md', 'claude_instructions.md',
  'claudeignore', '.claudeignore'
])

/** Collect Claude-related .md files at a project root level */
function collectClaudeRootMd(dir: string, rootDir: string, results: MdFileEntry[]): void {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (CLAUDE_ROOT_FILES.has(entry.name.toLowerCase())) {
        addMdEntry(path.join(dir, entry.name), rootDir, results)
      }
    }
  } catch { /* ignore */ }
}

/** Recursively collect ALL .md files inside a directory (for .claude/ subtree) */
function collectAllMdInDir(
  dir: string,
  rootDir: string,
  results: MdFileEntry[],
  depth: number
): void {
  if (depth > 8) return
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isFile() && /\.md$/i.test(entry.name)) {
        addMdEntry(fullPath, rootDir, results)
      } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
        collectAllMdInDir(fullPath, rootDir, results, depth + 1)
      }
    }
  } catch { /* ignore */ }
}

/** Scan child directories for .claude/ dirs and root-level Claude .md files */
function scanChildrenForClaudeMd(
  dir: string,
  rootDir: string,
  results: MdFileEntry[],
  depth: number
): void {
  if (depth > 3) return
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.')) continue
      if (SKIP_DIRS.has(entry.name)) continue

      const childPath = path.join(dir, entry.name)

      // Check for root-level Claude .md files in child dir
      collectClaudeRootMd(childPath, rootDir, results)

      // Check for .claude/ in child dir
      const claudeDir = path.join(childPath, '.claude')
      if (fs.existsSync(claudeDir)) {
        collectAllMdInDir(claudeDir, rootDir, results, 0)
      }

      // Recurse deeper
      scanChildrenForClaudeMd(childPath, rootDir, results, depth + 1)
    }
  } catch { /* ignore */ }
}

/** Helper: add a single .md file entry, deduplicating by path */
function addMdEntry(fullPath: string, rootDir: string, results: MdFileEntry[]): void {
  if (results.some((r) => r.path === fullPath)) return
  try {
    const stat = fs.statSync(fullPath)
    const relativePath = path.relative(rootDir, fullPath)
    const relDir = path.dirname(relativePath)
    results.push({
      name: path.basename(fullPath),
      path: fullPath,
      size: stat.size,
      relativePath,
      dir: relDir === '.' ? '.' : relDir
    })
  } catch { /* ignore */ }
}

/**
 * [S1] Validate that a file path is within a known workspace or home dir.
 * Prevents arbitrary file access via path traversal from the renderer.
 */
function isPathAllowed(filePath: string): boolean {
  const resolved = path.resolve(filePath)
  const home = os.homedir()

  // Allow files within any registered workspace
  for (const ws of store.workspaces) {
    if (resolved.startsWith(ws.path + path.sep) || resolved === ws.path) return true
  }
  // Allow files within home directory (for global .claude configs, etc.)
  if (resolved.startsWith(home + path.sep) || resolved === home) return true

  return false
}

function readFileContent(filePath: string): string | null {
  try {
    if (!isPathAllowed(filePath)) {
      console.warn('[zeus] readFileContent blocked — path outside allowed scope:', filePath)
      return null
    }
    return fs.readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
}

function writeFileContent(filePath: string, content: string): boolean {
  try {
    if (!isPathAllowed(filePath)) {
      console.warn('[zeus] writeFileContent blocked — path outside allowed scope:', filePath)
      return false
    }
    fs.writeFileSync(filePath, content, 'utf-8')
    return true
  } catch {
    return false
  }
}

// ── Claude Session (headless mode) ────────────────────────────────────────────

let cachedClaudePath: string | null = null

function getClaudeCliPath(): string {
  if (cachedClaudePath) return cachedClaudePath

  // Try login shell first (ensures full PATH on macOS GUI apps)
  const shell = process.env.SHELL || '/bin/zsh'
  const strategies = [
    () => execSync(`${shell} -l -c 'which claude'`, { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }).trim(),
    () => {
      const whichCmd = process.platform === 'win32' ? 'where claude' : 'which claude'
      return execSync(whichCmd, { encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] }).trim()
    }
  ]

  for (const strategy of strategies) {
    try {
      const result = strategy()
      if (result) {
        cachedClaudePath = result
        console.log('[zeus] Claude CLI found at:', result)
        return result
      }
    } catch { /* try next strategy */ }
  }

  console.warn('[zeus] Claude CLI not found in PATH, falling back to "claude"')
  return 'claude'
}

function spawnClaudeSession(conversationId: string, prompt: string, cwd: string, model?: string, resumeSessionId?: string): boolean {
  // Get or create session state
  let session = claudeSessions.get(conversationId)
  if (!session) {
    session = { process: null, sessionId: null, cwd }
    claudeSessions.set(conversationId, session)
  }

  // If resuming a saved session, set the sessionId so --resume is used
  if (resumeSessionId && !session.sessionId) {
    session.sessionId = resumeSessionId
  }

  // [R2] Kill any still-running process for this conversation
  if (session.process) {
    const oldProcess = session.process
    session.process = null
    try {
      oldProcess.kill('SIGINT')
      // Give the process a moment to die — avoids port/file conflicts
      oldProcess.removeAllListeners()
    } catch { /* ignore */ }
  }

  // Build args: claude -p "prompt" --output-format stream-json --verbose --include-partial-messages [--model x] [--resume sessionId]
  const claudePath = getClaudeCliPath()
  const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--include-partial-messages']

  if (model) {
    args.push('--model', model)
  }

  if (session.sessionId) {
    args.push('--resume', session.sessionId, '--continue')
  }

  const effectiveCwd = cwd && fs.existsSync(cwd) ? cwd : os.homedir()

  console.log(`[zeus] Spawning Claude session ${conversationId}:`, claudePath, args.map((a, i) => i === 1 ? `"${a.slice(0, 60)}..."` : a).join(' '))
  console.log(`[zeus] CWD: ${effectiveCwd}`)

  // Spawn claude process
  const child = spawn(claudePath, args, {
    cwd: effectiveCwd,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      LANG: process.env.LANG || 'en_US.UTF-8'
    },
    stdio: ['pipe', 'pipe', 'pipe']
  })

  // CRITICAL: Close stdin immediately — Claude with -p doesn't need it.
  // Leaving stdin open causes Claude to hang waiting for potential piped input.
  child.stdin?.end()

  session.process = child

  console.log(`[zeus] Claude process PID: ${child.pid}`)

  let buffer = ''

  child.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString()
    buffer += text

    const lines = buffer.split('\n')
    buffer = lines.pop()! // keep incomplete last line

    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const event = JSON.parse(line)
        // Extract session_id from events
        if (event.sessionId || event.session_id) {
          session!.sessionId = event.sessionId || event.session_id
        }
        mainWindow?.webContents.send('claude-session:event', {
          id: conversationId,
          event
        })
      } catch {
        // Non-JSON line — send as raw text event
        mainWindow?.webContents.send('claude-session:event', {
          id: conversationId,
          event: { type: 'raw', text: line }
        })
      }
    }
  })

  child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString()
    console.log(`[zeus] Claude stderr [${conversationId}]:`, text.slice(0, 200))
    // stderr can contain progress/debug info — forward as stderr event
    mainWindow?.webContents.send('claude-session:event', {
      id: conversationId,
      event: { type: 'stderr', text }
    })
  })

  child.on('close', (code) => {
    console.log(`[zeus] Claude process closed [${conversationId}] exit=${code}`)
    // Process remaining buffer
    if (buffer.trim()) {
      try {
        const event = JSON.parse(buffer)
        if (event.sessionId || event.session_id) {
          session!.sessionId = event.sessionId || event.session_id
        }
        mainWindow?.webContents.send('claude-session:event', {
          id: conversationId,
          event
        })
      } catch { /* ignore trailing junk */ }
    }

    session!.process = null

    mainWindow?.webContents.send('claude-session:done', {
      id: conversationId,
      exitCode: code ?? 0,
      sessionId: session!.sessionId
    })
  })

  child.on('error', (err) => {
    console.error(`[zeus] Claude spawn error [${conversationId}]:`, err.message)
    mainWindow?.webContents.send('claude-session:event', {
      id: conversationId,
      event: { type: 'error', text: err.message }
    })
    session!.process = null
    mainWindow?.webContents.send('claude-session:done', {
      id: conversationId,
      exitCode: 1,
      sessionId: session!.sessionId
    })
  })

  return true
}

function killAllClaudeSessions(): void {
  for (const [, s] of claudeSessions) {
    if (s.process) {
      try { s.process.kill('SIGINT') } catch { /* ignore */ }
    }
  }
  claudeSessions.clear()
}

// ── Lifecycle ──────────────────────────────────────────────────────────────────

function killAllTerminals(): void {
  for (const [, t] of terminals) {
    try { t.pty.kill() } catch { /* ignore */ }
  }
  terminals.clear()
  killAllClaudeSessions()
}

// ── Read Claude Code's native session JSONL transcript ───────────────────────
// Claude stores sessions in ~/.claude/projects/<encoded-path>/<session-uuid>.jsonl
// Each line is a JSONL object with types: user, assistant, tool_use, tool_result, progress, etc.
// We parse user/assistant messages into our ClaudeMessage format.

interface TranscriptMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  blocks?: Array<{ type: string; text?: string; name?: string; input?: Record<string, unknown>; content?: string; thinking?: string }>
  timestamp: number
}

function readClaudeTranscript(sessionId: string, workspacePath: string): TranscriptMessage[] {
  const claudeDir = path.join(os.homedir(), '.claude', 'projects')
  // Encode workspace path: /Users/young/Workspace/zeus → -Users-young-Workspace-zeus
  const encoded = workspacePath.replace(/\//g, '-')

  // Try the project dir first, then check parent path variants
  const candidates = [encoded]
  // Also try without leading dash
  if (encoded.startsWith('-')) candidates.push(encoded)

  let jsonlPath: string | null = null
  for (const candidate of candidates) {
    const p = path.join(claudeDir, candidate, `${sessionId}.jsonl`)
    if (fs.existsSync(p)) {
      jsonlPath = p
      break
    }
  }

  // Also search all project dirs for this session (fallback)
  if (!jsonlPath) {
    try {
      const dirs = fs.readdirSync(claudeDir)
      for (const dir of dirs) {
        const p = path.join(claudeDir, dir, `${sessionId}.jsonl`)
        if (fs.existsSync(p)) {
          jsonlPath = p
          break
        }
      }
    } catch { /* ignore */ }
  }

  if (!jsonlPath) return []

  try {
    const raw = fs.readFileSync(jsonlPath, 'utf-8')
    const lines = raw.split('\n').filter((l) => l.trim())
    const messages: TranscriptMessage[] = []

    for (const line of lines) {
      try {
        const obj = JSON.parse(line)
        const type = obj.type as string
        const msg = obj.message as { role?: string; content?: unknown } | undefined
        const timestamp = obj.timestamp ? new Date(obj.timestamp).getTime() : Date.now()

        if (type === 'user' && msg?.role === 'user') {
          const content = msg.content
          let text = ''
          if (typeof content === 'string') {
            text = content
          } else if (Array.isArray(content)) {
            // Extract text parts, skip tool_result entries
            const textParts: string[] = []
            for (const part of content) {
              if (typeof part === 'string') textParts.push(part)
              else if (part?.type === 'text' && typeof part.text === 'string') {
                // Skip IDE-injected context messages
                if (!part.text.startsWith('<ide_opened_file>') && !part.text.startsWith('<ide_')) {
                  textParts.push(part.text)
                }
              }
            }
            text = textParts.join('\n')
          }
          // Skip tool_result-only user messages and empty ones
          if (text.trim()) {
            messages.push({
              id: obj.uuid || `msg-${timestamp}-user`,
              role: 'user',
              content: text.trim(),
              timestamp
            })
          }
        } else if (type === 'assistant' && msg?.role === 'assistant') {
          const content = msg.content
          const blocks: TranscriptMessage['blocks'] = []
          const textParts: string[] = []

          if (typeof content === 'string') {
            textParts.push(content)
            blocks.push({ type: 'text', text: content })
          } else if (Array.isArray(content)) {
            for (const part of content) {
              if (typeof part === 'string') {
                textParts.push(part)
                blocks.push({ type: 'text', text: part })
              } else if (part?.type === 'text' && typeof part.text === 'string') {
                textParts.push(part.text)
                blocks.push({ type: 'text', text: part.text })
              } else if (part?.type === 'thinking' && typeof part.thinking === 'string') {
                blocks.push({ type: 'thinking', thinking: part.thinking.slice(0, 300) })
              } else if (part?.type === 'tool_use') {
                blocks.push({
                  type: 'tool_use',
                  name: part.name || 'unknown',
                  input: part.input || {}
                })
              }
            }
          }

          // Only add if there's actual content (skip tool-use-only messages with no text)
          if (textParts.join('').trim() || blocks.length > 0) {
            messages.push({
              id: obj.uuid || `msg-${timestamp}-assistant`,
              role: 'assistant',
              content: textParts.join('\n'),
              blocks: blocks.length > 0 ? blocks : undefined,
              timestamp
            })
          }
        }
      } catch { /* skip malformed lines */ }
    }

    // Merge consecutive assistant messages (Claude sends multiple chunks)
    const merged: TranscriptMessage[] = []
    for (const msg of messages) {
      const prev = merged[merged.length - 1]
      if (prev && prev.role === 'assistant' && msg.role === 'assistant') {
        // Merge text
        if (msg.content) {
          prev.content = prev.content ? prev.content + '\n' + msg.content : msg.content
        }
        // Merge blocks
        if (msg.blocks) {
          prev.blocks = [...(prev.blocks || []), ...msg.blocks]
        }
      } else {
        merged.push({ ...msg })
      }
    }

    return merged
  } catch (e) {
    console.error('[zeus] Failed to read Claude transcript:', e)
    return []
  }
}

app.whenReady().then(() => {
  pty = require('node-pty')
  store = loadStore()
  registerIPC()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  killAllTerminals()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', killAllTerminals)
