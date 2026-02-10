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
  /** Whether stdin is still open and writable for prompt responses */
  stdinReady: boolean
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

let _saveStoreTimer: ReturnType<typeof setTimeout> | null = null
let _saveStorePending = false

function saveStore(data: AppStore): void {
  _saveStorePending = true
  // Debounce rapid saves (e.g. session auto-saves) to max once per 500ms
  if (_saveStoreTimer) return
  _saveStoreTimer = setTimeout(() => {
    _saveStoreTimer = null
    if (!_saveStorePending) return
    _saveStorePending = false
    try {
      fs.mkdirSync(path.dirname(storeFilePath), { recursive: true })
      fs.writeFileSync(storeFilePath, JSON.stringify(data, null, 2), 'utf-8')
    } catch (e) {
      console.error('[zeus] Failed to save store:', e)
    }
  }, 500)
}

/** Immediately flush any pending store save (call on quit) */
function flushStore(): void {
  if (_saveStoreTimer) {
    clearTimeout(_saveStoreTimer)
    _saveStoreTimer = null
  }
  if (_saveStorePending) {
    _saveStorePending = false
    try {
      fs.mkdirSync(path.dirname(storeFilePath), { recursive: true })
      fs.writeFileSync(storeFilePath, JSON.stringify(store, null, 2), 'utf-8')
    } catch (e) {
      console.error('[zeus] Failed to flush store:', e)
    }
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

interface ModelAliasInfo {
  alias: string
  fullName: string
  version: string
}

function getClaudeModelAliases(): ModelAliasInfo[] {
  try {
    const claudePath = getClaudeCliPath()
    const realPath = fs.realpathSync(claudePath)

    let src: string | null = null

    // Strategy 1: npm-installed package (cli.js in parent dir)
    const pkgDir = path.resolve(path.dirname(realPath), '..')
    const cliJs = path.join(pkgDir, 'cli.js')
    if (fs.existsSync(cliJs)) {
      src = fs.readFileSync(cliJs, 'utf-8')
    }

    // Strategy 2: native binary — extract strings containing model aliases
    if (!src) {
      try {
        const raw = execSync(
          `strings "${realPath}" | grep -oE '\\{opus:"claude-[^"]+",sonnet:"claude-[^"]+",haiku:"claude-[^"]+"\\}' | head -1`,
          { encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }
        ).trim()
        if (raw) src = raw
      } catch { /* ignore */ }
    }

    if (!src) return []

    // Match alias mapping: {opus:"claude-opus-4-6",sonnet:"claude-sonnet-4-5-20250929",haiku:"claude-haiku-4-5-20251001"}
    const aliasRegex = /\{(\s*\w+\s*:\s*"claude-[\w-]+"\s*,?\s*)+\}/g
    const matches = src.matchAll(aliasRegex)

    for (const m of matches) {
      const block = m[0]
      const entries = [...block.matchAll(/(\w+)\s*:\s*"(claude-[\w-]+)"/g)]
      if (entries.length < 2) continue

      const models: ModelAliasInfo[] = []
      for (const [, alias, fullName] of entries) {
        // Extract version: claude-opus-4-6 → 4.6, claude-sonnet-4-5-20250929 → 4.5
        const verMatch = fullName.match(/claude-\w+-(\d+(?:-\d+)?)(?:-\d{8})?$/)
        const version = verMatch ? verMatch[1].replace(/-/g, '.') : ''
        models.push({ alias, fullName, version })
      }
      if (models.length >= 2) return models
    }
    return []
  } catch {
    return []
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
      // Invalidate cached path — the binary location may have changed
      cachedClaudePath = null
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

  // Resolve app icon (works for dev & packaged)
  const iconPath = path.join(
    app.isPackaged ? process.resourcesPath : path.join(__dirname, '../../resources'),
    process.platform === 'win32' ? 'icon.ico' : 'icon.png'
  )

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
    ...(process.platform !== 'darwin' && fs.existsSync(iconPath) ? { icon: iconPath } : {}),
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
      flushStore() // immediate write on close — don't lose window bounds
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
    if (store.lastWorkspace === wsPath) store.lastWorkspace = null
    saveStore(store)
    return true
  })

  ipcMain.handle('workspace:rename', (_, wsPath: string, newName: string) => {
    const ws = store.workspaces.find((w) => w.path === wsPath)
    if (ws) {
      ws.name = newName.trim() || path.basename(wsPath)
      saveStore(store)
      return true
    }
    return false
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
  ipcMain.handle('claude:models', () => getClaudeModelAliases())
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
  ipcMain.handle('mcp:health', () => checkMcpHealth())

  // ── Plugins ──
  ipcMain.handle('plugin:list', () => listPlugins())
  ipcMain.handle('plugin:marketplace-list', () => listMarketplaces())
  ipcMain.handle('plugin:install', (_, name: string, scope?: string) => runPluginCmd('install', name, scope))
  ipcMain.handle('plugin:uninstall', (_, name: string) => runPluginCmd('uninstall', name))
  ipcMain.handle('plugin:enable', (_, name: string, scope?: string) => runPluginCmd('enable', name, scope))
  ipcMain.handle('plugin:disable', (_, name: string, scope?: string) => runPluginCmd('disable', name, scope))
  ipcMain.handle('plugin:marketplace-add', (_, source: string) => runPluginCmd('marketplace add', source))

  // Skills — scan .claude/commands/ recursively
  ipcMain.handle('skills:scan', (_, wsPath: string) => scanCustomSkills(wsPath))

  // Files / Markdown
  ipcMain.handle('files:list-md', (_, dirPath: string) => listMarkdownFiles(dirPath))
  ipcMain.handle('files:read', (_, filePath: string) => readFileContent(filePath))
  ipcMain.handle('files:write', (_, filePath: string, content: string) => writeFileContent(filePath, content))

  // Git diff
  ipcMain.handle('git:diff', (_, workspacePath: string) => getGitDiff(workspacePath))
  ipcMain.handle('git:diff-file', (_, workspacePath: string, filePath: string) => getGitDiffFile(workspacePath, filePath))
  ipcMain.handle('git:changed-files', (_, workspacePath: string) => getGitChangedFiles(workspacePath))

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
      // End stdin before killing to avoid EPIPE
      if (session.stdinReady && session.process.stdin && !session.process.stdin.destroyed) {
        try { session.process.stdin.end() } catch { /* ignore */ }
        session.stdinReady = false
      }
      session.process.kill('SIGINT')
    }
    return true
  })

  // Respond to a permission/choice prompt from Claude Code.
  // Primary path: write the response directly to the still-open stdin.
  // Fallback:      abort + re-spawn with --resume if stdin is unavailable.
  ipcMain.handle('claude-session:respond', (_, conversationId: string, response: string) => {
    const session = claudeSessions.get(conversationId)
    if (!session) return false

    // Primary: write directly to stdin (fast, preserves process)
    if (session.stdinReady && session.process?.stdin && !session.process.stdin.destroyed) {
      console.log(`[zeus] Responding to prompt [${conversationId}] via stdin: "${response}"`)
      session.process.stdin.write(response + '\n')
      return true
    }

    // Fallback: abort current process and re-spawn with --resume
    console.log(`[zeus] stdin unavailable for [${conversationId}], falling back to abort+resume`)
    if (session.process) {
      try { session.process.kill('SIGINT') } catch { /* ignore */ }
      session.process.removeAllListeners()
      session.process.stdout?.removeAllListeners()
      session.process.stderr?.removeAllListeners()
      session.process = null
    }

    if (session.sessionId && session.cwd) {
      return spawnClaudeSession(conversationId, response, session.cwd, undefined, session.sessionId)
    }
    return false
  })

  // [B1] Clean up session entry when conversation is closed from renderer
  ipcMain.handle('claude-session:close', (_, conversationId: string) => {
    const session = claudeSessions.get(conversationId)
    if (session?.process) {
      try {
        if (session.stdinReady && session.process.stdin && !session.process.stdin.destroyed) {
          session.process.stdin.end()
        }
        session.process.kill('SIGINT')
      } catch { /* ignore */ }
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

// ── MCP Health ───────────────────────────────────────────────────────────────

interface McpHealthEntry {
  name: string
  command: string       // e.g. "npx -y mcp-remote ..." or "https://mcp.example.com"
  transport: string     // "HTTP" | "stdio" | "SSE" | ""
  status: 'connected' | 'failed' | 'unknown'
  error?: string
}

function checkMcpHealth(): Promise<McpHealthEntry[]> {
  return new Promise((resolve) => {
    const claudePath = getClaudeCliPath()
    const child = spawn(claudePath, ['mcp', 'list'], {
      shell: true,
      env: { ...process.env },
      timeout: 30000
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (d: Buffer) => (stdout += d.toString()))
    child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()))
    child.on('close', () => {
      const entries: McpHealthEntry[] = []
      const combined = stdout + stderr
      // Parse lines like:
      //   context7: https://mcp.context7.com/mcp (HTTP) - ✓ Connected
      //   plugin:github:github: https://api.githubcopilot.com/mcp/ (HTTP) - ✗ Failed to connect
      //   serena: npx -y mcp-remote http://... - ✓ Connected
      for (const line of combined.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('Checking')) continue

        // Match: name: command/url (transport) - status
        // or:    name: command/url - status
        const match = trimmed.match(
          /^(.+?):\s+(.+?)\s*(?:\((\w+)\)\s*)?-\s+[✓✗]\s*(.+)$/
        )
        if (!match) continue

        const [, rawName, command, transport, statusText] = match
        const name = rawName.trim()
        const connected = statusText.trim().toLowerCase().includes('connected')
        entries.push({
          name,
          command: command.trim(),
          transport: transport || '',
          status: connected ? 'connected' : 'failed',
          error: connected ? undefined : statusText.trim()
        })
      }
      resolve(entries)
    })
    child.on('error', () => resolve([]))
  })
}

// ── Plugins ──────────────────────────────────────────────────────────────────

interface PluginEntry {
  name: string        // e.g. "github@claude-plugins-official"
  version: string
  scope: string       // "user" | "project" | "local"
  enabled: boolean
}

interface MarketplaceEntry {
  name: string
  source: string
}

function listPlugins(): Promise<PluginEntry[]> {
  return new Promise((resolve) => {
    const claudePath = getClaudeCliPath()
    const child = spawn(claudePath, ['plugin', 'list'], {
      shell: true,
      env: { ...process.env },
      timeout: 15000
    })
    let stdout = ''
    child.stdout?.on('data', (d: Buffer) => (stdout += d.toString()))
    child.on('close', () => {
      const plugins: PluginEntry[] = []
      // Parse the output: "  ❯ name@marketplace\n    Version: ...\n    Scope: ...\n    Status: ✔ enabled"
      const blocks = stdout.split(/\n\s*❯\s+/).filter(Boolean)
      for (const block of blocks) {
        const lines = block.trim().split('\n')
        const nameLine = lines[0]?.trim()
        if (!nameLine) continue
        // Must have Version, Scope, and Status lines — skip headers / malformed blocks
        const versionLine = lines.find(l => l.includes('Version:'))
        const scopeLine = lines.find(l => l.includes('Scope:'))
        const statusLine = lines.find(l => l.includes('Status:'))
        if (!versionLine || !scopeLine || !statusLine) continue
        // Must contain @ (e.g. "github@claude-plugins-official")
        if (!nameLine.includes('@')) continue
        const version = versionLine.replace(/.*Version:\s*/, '').trim()
        const scope = scopeLine.replace(/.*Scope:\s*/, '').trim()
        const enabled = statusLine.includes('enabled')
        plugins.push({ name: nameLine, version, scope, enabled })
      }
      resolve(plugins)
    })
    child.on('error', () => resolve([]))
  })
}

function listMarketplaces(): Promise<MarketplaceEntry[]> {
  return new Promise((resolve) => {
    const claudePath = getClaudeCliPath()
    const child = spawn(claudePath, ['plugin', 'marketplace', 'list'], {
      shell: true,
      env: { ...process.env },
      timeout: 15000
    })
    let stdout = ''
    child.stdout?.on('data', (d: Buffer) => (stdout += d.toString()))
    child.on('close', () => {
      const marketplaces: MarketplaceEntry[] = []
      const blocks = stdout.split(/\n\s*❯\s+/).filter(Boolean)
      for (const block of blocks) {
        const lines = block.trim().split('\n')
        const name = lines[0]?.trim()
        if (!name) continue
        // Skip header blocks (e.g. "Configured marketplaces:") that don't contain Source:
        if (!lines.some(l => l.includes('Source:'))) continue
        const source = lines.find(l => l.includes('Source:'))?.replace(/.*Source:\s*/, '').trim() || ''
        marketplaces.push({ name, source })
      }
      resolve(marketplaces)
    })
    child.on('error', () => resolve([]))
  })
}

function runPluginCmd(
  action: string,
  target: string,
  scope?: string
): Promise<{ success: boolean; output?: string; error?: string }> {
  return new Promise((resolve) => {
    const claudePath = getClaudeCliPath()
    const args = ['plugin', ...action.split(' '), target]
    if (scope && (action === 'install' || action === 'enable' || action === 'disable')) {
      args.push('--scope', scope)
    }
    console.log(`[zeus] Running: ${claudePath} ${args.join(' ')}`)
    const child = spawn(claudePath, args, {
      shell: true,
      env: { ...process.env },
      timeout: 30000
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (d: Buffer) => (stdout += d.toString()))
    child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()))
    child.on('close', (code) => {
      if (code === 0) resolve({ success: true, output: stdout })
      else resolve({ success: false, error: stderr || stdout || `Exit code ${code}` })
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
  /** Agent color from YAML frontmatter (e.g. "purple", "cyan") */
  color?: string
  /** Description from YAML frontmatter (overrides content preview) */
  metaDescription?: string
}

/** Parse YAML frontmatter from a markdown file and return { meta, body } */
function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const meta: Record<string, string> = {}
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!match) return { meta, body: raw }

  const yamlBlock = match[1]
  const body = raw.slice(match[0].length)

  // Simple line-by-line parsing for flat key: value pairs
  for (const line of yamlBlock.split('\n')) {
    const kv = line.match(/^(\w[\w-]*):\s*(.+)$/)
    if (kv) {
      meta[kv[1].trim()] = kv[2].trim()
    }
  }
  return { meta, body }
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
          const { meta, body } = parseFrontmatter(raw)

          // Use frontmatter name if available (overrides path-derived name)
          const entryName = meta.name || colonName

          results.push({
            name: entryName,
            filename: entry.name,
            filePath: fullPath,
            scope,
            kind,
            relativeTo,
            content: (body || raw).slice(0, 200),
            subdir,
            color: meta.color || undefined,
            metaDescription: meta.description || undefined
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

// ── Prompt Detection ─────────────────────────────────────────────────────────
// Detect permission prompts and option requests from Claude Code's stderr output.
// These appear when Claude wants to use a tool that needs permission, or when it
// presents numbered options for the user to choose from.

interface DetectedPrompt {
  promptType: 'permission' | 'yesno' | 'choice' | 'input'
  message: string
  options: { label: string; value: string; key?: string }[]
  toolName?: string
  toolInput?: string
}

function detectPrompt(text: string): DetectedPrompt | null {
  // ── Permission: "Allow <tool>? (y)es / (n)o / (a)lways / ..." ──
  // Common patterns:
  //   "? Allow Read(...) (y/n)"
  //   "Do you want to allow Bash(rm -rf ...)? (y/n/a)"
  //   "Allow mcp__server__tool? Yes / No / Always allow"
  const permissionMatch = text.match(
    /(?:\?\s*)?(?:Allow|Do you want to allow|Approve)\s+(.+?)(?:\s*\?\s*|\s+)?\(([ynaYNA/\s]+)\)/i
  )
  if (permissionMatch) {
    const toolDesc = permissionMatch[1].trim()
    const optStr = permissionMatch[2].toLowerCase()
    const options: DetectedPrompt['options'] = []
    if (optStr.includes('y')) options.push({ label: 'Yes', value: 'y', key: 'y' })
    if (optStr.includes('n')) options.push({ label: 'No', value: 'n', key: 'n' })
    if (optStr.includes('a')) options.push({ label: 'Always', value: 'a', key: 'a' })
    // Parse tool name/input from "ToolName(input)" format
    const toolParts = toolDesc.match(/^(\w+)\((.+)\)$/)
    return {
      promptType: 'permission',
      message: text,
      options: options.length > 0 ? options : [
        { label: 'Yes', value: 'y', key: 'y' },
        { label: 'No', value: 'n', key: 'n' }
      ],
      toolName: toolParts?.[1],
      toolInput: toolParts?.[2]
    }
  }

  // ── Permission: "Yes / No / Always allow" style (multi-line) ──
  const yesNoAlwaysMatch = text.match(
    /(?:Allow|Approve|accept|permit|trust)\b.+?(?:\n|.)*?(Yes|No|Always|Deny|Allow|Cancel)/i
  )
  if (yesNoAlwaysMatch && /\b(?:yes|no|always|deny|allow|cancel)\b/i.test(text)) {
    const options: DetectedPrompt['options'] = []
    if (/\byes\b/i.test(text)) options.push({ label: 'Yes', value: 'y', key: 'y' })
    if (/\bno\b/i.test(text)) options.push({ label: 'No', value: 'n', key: 'n' })
    if (/\balways\b/i.test(text)) options.push({ label: 'Always', value: 'a', key: 'a' })
    if (/\bdeny\b/i.test(text)) options.push({ label: 'Deny', value: 'n', key: 'n' })
    if (options.length >= 2) {
      return {
        promptType: 'yesno',
        message: text,
        options
      }
    }
  }

  // ── Numbered choices: "1) ...\n2) ...\n3) ..." or "1. ... 2. ..." ──
  const numberedLines = text.match(/^\s*(\d+)[.)]\s+.+$/gm)
  if (numberedLines && numberedLines.length >= 2) {
    const options: DetectedPrompt['options'] = []
    for (const line of numberedLines) {
      const m = line.match(/^\s*(\d+)[.)]\s+(.+)$/)
      if (m) {
        options.push({ label: m[2].trim(), value: m[1], key: m[1] })
      }
    }
    if (options.length >= 2) {
      // Extract the question/header (text before the first numbered line)
      const firstIdx = text.indexOf(numberedLines[0])
      const header = firstIdx > 0 ? text.slice(0, firstIdx).trim() : 'Choose an option'
      return {
        promptType: 'choice',
        message: header || 'Choose an option',
        options
      }
    }
  }

  // ── Generic yes/no: "... (y/n)" or "... [Y/n]" ──
  const ynMatch = text.match(/(.+?)\s*[\[(]([yYnN][/|][yYnN])[\])]\s*$/)
  if (ynMatch) {
    return {
      promptType: 'yesno',
      message: ynMatch[1].trim(),
      options: [
        { label: 'Yes', value: 'y', key: 'y' },
        { label: 'No', value: 'n', key: 'n' }
      ]
    }
  }

  // ── Waiting for input: "? ..." or "Enter ..." ending with ":" ──
  const inputMatch = text.match(/^\?\s+(.+?):\s*$/)
  if (inputMatch) {
    return {
      promptType: 'input',
      message: inputMatch[1].trim(),
      options: []
    }
  }

  return null
}

function spawnClaudeSession(conversationId: string, prompt: string, cwd: string, model?: string, resumeSessionId?: string): boolean {
  // Get or create session state
  let session = claudeSessions.get(conversationId)
  if (!session) {
    session = { process: null, sessionId: null, cwd, stdinReady: false }
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

  // Safety: if prompt starts with "-", prefix with a newline to prevent CLI misinterpretation
  const safePrompt = prompt.startsWith('-') ? '\n' + prompt : prompt

  const args = ['-p', safePrompt, '--output-format', 'stream-json', '--verbose', '--include-partial-messages']

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

  // Keep stdin open so we can respond to permission/choice prompts interactively.
  // Safety: if Claude produces no output within 5 seconds (possible hang waiting for
  // piped input), close stdin as a fallback.
  session.stdinReady = true
  let gotOutput = false
  const stdinSafetyTimer = setTimeout(() => {
    if (!gotOutput && child.stdin && !child.stdin.destroyed) {
      console.log(`[zeus] No output after 5s [${conversationId}] — closing stdin as safety fallback`)
      try { child.stdin.end() } catch { /* ignore */ }
      session!.stdinReady = false
    }
  }, 5000)

  child.stdout?.once('data', () => {
    gotOutput = true
    clearTimeout(stdinSafetyTimer)
  })

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

  // Accumulate stderr for multi-chunk prompt detection
  let stderrBuf = ''
  let stderrFlushTimer: ReturnType<typeof setTimeout> | null = null

  child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString()
    console.log(`[zeus] Claude stderr [${conversationId}]:`, text.slice(0, 300))

    stderrBuf += text

    // Debounce: flush after 150ms of silence to assemble multi-chunk prompts
    if (stderrFlushTimer) clearTimeout(stderrFlushTimer)
    stderrFlushTimer = setTimeout(() => {
      const full = stderrBuf
      stderrBuf = ''
      // Strip ANSI escape codes for prompt detection
      const clean = full.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim()
      const prompt = detectPrompt(clean)
      if (prompt) {
        mainWindow?.webContents.send('claude-session:event', {
          id: conversationId,
          event: { type: 'prompt', ...prompt, rawText: clean }
        })
      } else {
        // Regular stderr — forward for status display
        mainWindow?.webContents.send('claude-session:event', {
          id: conversationId,
          event: { type: 'stderr', text: full }
        })
      }
    }, 150)
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
    session!.stdinReady = false

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

// ── Git Diff Helpers ────────────────────────────────────────────────────────

interface GitChangedFile {
  path: string
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'unknown'
  additions: number
  deletions: number
}

function getGitDiff(workspacePath: string): string {
  try {
    // Get both staged and unstaged changes
    const diff = execSync('git diff HEAD', {
      cwd: workspacePath,
      encoding: 'utf-8',
      timeout: 10000,
      maxBuffer: 5 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    // If no diff against HEAD, try working tree changes
    if (!diff.trim()) {
      return execSync('git diff', {
        cwd: workspacePath,
        encoding: 'utf-8',
        timeout: 10000,
        maxBuffer: 5 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe']
      })
    }
    return diff
  } catch {
    return ''
  }
}

function getGitDiffFile(workspacePath: string, filePath: string): string {
  try {
    const diff = execSync(`git diff HEAD -- "${filePath}"`, {
      cwd: workspacePath,
      encoding: 'utf-8',
      timeout: 10000,
      maxBuffer: 5 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    if (!diff.trim()) {
      return execSync(`git diff -- "${filePath}"`, {
        cwd: workspacePath,
        encoding: 'utf-8',
        timeout: 10000,
        maxBuffer: 5 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe']
      })
    }
    return diff
  } catch {
    return ''
  }
}

function getGitChangedFiles(workspacePath: string): GitChangedFile[] {
  try {
    // Use git diff --numstat to get additions/deletions per file
    const numstat = execSync('git diff HEAD --numstat', {
      cwd: workspacePath,
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim()

    // Also get status letters
    const nameStatus = execSync('git diff HEAD --name-status', {
      cwd: workspacePath,
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim()

    const statusMap = new Map<string, string>()
    for (const line of nameStatus.split('\n')) {
      if (!line.trim()) continue
      const [status, ...rest] = line.split('\t')
      const fpath = rest.join('\t')
      if (fpath) statusMap.set(fpath, status)
    }

    const files: GitChangedFile[] = []
    for (const line of numstat.split('\n')) {
      if (!line.trim()) continue
      const [add, del, ...rest] = line.split('\t')
      const fpath = rest.join('\t')
      if (!fpath) continue
      const rawStatus = statusMap.get(fpath) ?? 'M'
      let status: GitChangedFile['status'] = 'modified'
      if (rawStatus.startsWith('A')) status = 'added'
      else if (rawStatus.startsWith('D')) status = 'deleted'
      else if (rawStatus.startsWith('R')) status = 'renamed'
      files.push({
        path: fpath,
        status,
        additions: parseInt(add) || 0,
        deletions: parseInt(del) || 0
      })
    }

    // Also check untracked/unstaged if HEAD diff was empty
    if (files.length === 0) {
      const unstaged = execSync('git diff --numstat', {
        cwd: workspacePath,
        encoding: 'utf-8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim()
      const unstagedStatus = execSync('git diff --name-status', {
        cwd: workspacePath,
        encoding: 'utf-8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim()

      const sMap2 = new Map<string, string>()
      for (const line of unstagedStatus.split('\n')) {
        if (!line.trim()) continue
        const [s, ...r] = line.split('\t')
        const fp = r.join('\t')
        if (fp) sMap2.set(fp, s)
      }

      for (const line of unstaged.split('\n')) {
        if (!line.trim()) continue
        const [add, del, ...rest] = line.split('\t')
        const fpath = rest.join('\t')
        if (!fpath) continue
        const rawStatus = sMap2.get(fpath) ?? 'M'
        let status: GitChangedFile['status'] = 'modified'
        if (rawStatus.startsWith('A')) status = 'added'
        else if (rawStatus.startsWith('D')) status = 'deleted'
        else if (rawStatus.startsWith('R')) status = 'renamed'
        files.push({
          path: fpath,
          status,
          additions: parseInt(add) || 0,
          deletions: parseInt(del) || 0
        })
      }
    }

    return files
  } catch {
    return []
  }
}

function killAllClaudeSessions(): void {
  for (const [, s] of claudeSessions) {
    if (s.process) {
      try {
        if (s.stdinReady && s.process.stdin && !s.process.stdin.destroyed) {
          s.process.stdin.end()
        }
        s.process.removeAllListeners()
        s.process.stdout?.removeAllListeners()
        s.process.stderr?.removeAllListeners()
        s.process.kill('SIGINT')
      } catch { /* ignore */ }
      s.process = null
      s.stdinReady = false
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

app.on('before-quit', () => {
  killAllTerminals()
  flushStore()
})
