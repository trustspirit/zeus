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

interface AppStore {
  workspaces: Workspace[]
  lastWorkspace: string | null
  idePreference: string
  windowBounds: { x?: number; y?: number; width: number; height: number } | null
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

// ── State ──────────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null
let pty: typeof PtyModule
const terminals = new Map<number, TermEntry>()
let nextTermId = 1
let store: AppStore

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
    terminals.get(id)?.pty.resize(cols, rows)
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
  ipcMain.handle('claude:update', () => updateClaudeCode())

  // IDE
  ipcMain.handle('ide:list', () => detectInstalledIDEs())

  ipcMain.handle('ide:open', (_, { ideCmd, workspacePath }: { ideCmd: string; workspacePath: string }) => {
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

// ── Custom Skills Scanner ─────────────────────────────────────────────────────

interface CustomSkillEntry {
  name: string // command name derived from filename (without .md)
  filename: string // e.g. "refactor.md"
  filePath: string // absolute path to the .md file
  scope: 'user' | 'project' // global ~/.claude/commands vs project .claude/commands
  relativeTo: string // workspace root or parent dir where .claude/ was found
  content: string // first 200 chars for description preview
}

/**
 * Scan for custom slash commands (.md files in .claude/commands/) from:
 * 1. Global: ~/.claude/commands/
 * 2. Project root: <wsPath>/.claude/commands/
 * 3. Child directories (depth-limited): <wsPath>/<child>/.claude/commands/
 */
function scanCustomSkills(wsPath: string): CustomSkillEntry[] {
  const results: CustomSkillEntry[] = []

  // 1. Global user commands (always)
  const globalCmdsDir = path.join(os.homedir(), '.claude', 'commands')
  collectCommandFiles(globalCmdsDir, 'user', os.homedir(), results)

  // 2 & 3: Only if workspace path is provided
  if (wsPath && fs.existsSync(wsPath)) {
    // 2. Project root
    const projectCmdsDir = path.join(wsPath, '.claude', 'commands')
    collectCommandFiles(projectCmdsDir, 'project', wsPath, results)

    // 3. Recurse into child directories (depth-limited)
    scanChildrenForCommands(wsPath, results, 0)
  }

  return results
}

function collectCommandFiles(
  cmdsDir: string,
  scope: 'user' | 'project',
  relativeTo: string,
  results: CustomSkillEntry[]
): void {
  try {
    if (!fs.existsSync(cmdsDir) || !fs.statSync(cmdsDir).isDirectory()) return
    const entries = fs.readdirSync(cmdsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (!/\.md$/i.test(entry.name)) continue
      const filePath = path.join(cmdsDir, entry.name)
      // Avoid duplicates
      if (results.some((r) => r.filePath === filePath)) continue
      try {
        const raw = fs.readFileSync(filePath, 'utf-8')
        const name = entry.name.replace(/\.md$/i, '')
        results.push({
          name,
          filename: entry.name,
          filePath,
          scope,
          relativeTo,
          content: raw.slice(0, 200)
        })
      } catch { /* unreadable file */ }
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
  const SKIP_DIRS = new Set([
    'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out',
    '.next', '.nuxt', '.output', '__pycache__', 'venv', '.venv',
    'target', 'vendor', '.idea', '.vscode', 'coverage'
  ])
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.') && entry.name !== '.claude') continue
      if (SKIP_DIRS.has(entry.name)) continue

      const childPath = path.join(dir, entry.name)

      // Check if this child has .claude/commands/
      const cmdsDir = path.join(childPath, '.claude', 'commands')
      if (fs.existsSync(cmdsDir)) {
        collectCommandFiles(cmdsDir, 'project', childPath, results)
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

function listMarkdownFiles(dirPath: string): MdFileEntry[] {
  const results: MdFileEntry[] = []
  try {
    collectMdFiles(dirPath, dirPath, results, 0)
  } catch { /* ignore */ }
  // Sort by directory first, then by name
  return results.sort((a, b) => {
    if (a.dir !== b.dir) return a.dir.localeCompare(b.dir)
    return a.name.localeCompare(b.name)
  })
}

const MD_SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out',
  '.next', '.nuxt', '.output', '__pycache__', 'venv', '.venv',
  'target', 'vendor', 'coverage', '.cache', '.turbo'
])

function collectMdFiles(
  rootDir: string,
  dir: string,
  results: MdFileEntry[],
  depth: number
): void {
  if (depth > 5) return // generous depth for docs
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.') || MD_SKIP_DIRS.has(entry.name)) continue
      const fullPath = path.join(dir, entry.name)
      if (entry.isFile() && /\.md$/i.test(entry.name)) {
        const stat = fs.statSync(fullPath)
        const relativePath = path.relative(rootDir, fullPath)
        const relDir = path.relative(rootDir, dir) || '.'
        results.push({
          name: entry.name,
          path: fullPath,
          size: stat.size,
          relativePath,
          dir: relDir
        })
      } else if (entry.isDirectory()) {
        collectMdFiles(rootDir, fullPath, results, depth + 1)
      }
    }
  } catch { /* permission error, etc. */ }
}

function readFileContent(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
}

function writeFileContent(filePath: string, content: string): boolean {
  try {
    fs.writeFileSync(filePath, content, 'utf-8')
    return true
  } catch {
    return false
  }
}

// ── Lifecycle ──────────────────────────────────────────────────────────────────

function killAllTerminals(): void {
  for (const [, t] of terminals) {
    try { t.pty.kill() } catch { /* ignore */ }
  }
  terminals.clear()
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
