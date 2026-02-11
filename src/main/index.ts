/**
 * Zeus — Electron main process entry point.
 * Handles app lifecycle, window management, menu, and IPC registration.
 * Business logic is delegated to specialised modules.
 */
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

// ── Modules ────────────────────────────────────────────────────────────────────

import { initStore, getStore, saveStore, flushStore } from './store.js'
import { initTerminal, createTerminal, getTerminal, killTerminal, killAllTerminals } from './terminal.js'
import {
  IDE_LIST,
  detectInstalledIDEs,
  isClaudeCodeInstalled,
  getClaudeCodeVersion,
  getClaudeModelAliases,
  checkLatestClaudeVersion,
  updateClaudeCode
} from './claude-cli.js'
import {
  initClaudeSession,
  getSession,
  deleteSession,
  spawnClaudeSession,
  killAllClaudeSessions
} from './claude-session.js'
import {
  readClaudeConfig,
  writeClaudeConfig,
  readProjectClaudeConfig,
  writeProjectClaudeConfig,
  installMCPPackage,
  checkMcpHealth,
  listPlugins,
  listMarketplaces,
  runPluginCmd
} from './claude-config.js'
import { scanCustomSkills } from './skills.js'
import {
  listMarkdownFiles,
  readFileContent,
  writeFileContent,
  getGitDiff,
  getGitDiffFile,
  getGitChangedFiles,
  readClaudeTranscript
} from './files.js'

// ── State ──────────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null

// ── Window ─────────────────────────────────────────────────────────────────────

function createWindow(): void {
  const store = getStore()
  const bounds = store.windowBounds

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

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  mainWindow.on('close', () => {
    if (mainWindow) {
      const store = getStore()
      store.windowBounds = mainWindow.getBounds()
      saveStore()
      flushStore()
    }
  })

  mainWindow.on('closed', () => { mainWindow = null })

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
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
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

// ── IPC Registration ───────────────────────────────────────────────────────────

function registerIPC(): void {
  const store = getStore()

  // ── Workspace ──
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
      saveStore()
    }
    return { path: dirPath, name }
  })

  ipcMain.handle('workspace:remove', (_, wsPath: string) => {
    store.workspaces = store.workspaces.filter((w) => w.path !== wsPath)
    if (store.lastWorkspace === wsPath) store.lastWorkspace = null
    saveStore()
    return true
  })

  ipcMain.handle('workspace:rename', (_, wsPath: string, newName: string) => {
    const ws = store.workspaces.find((w) => w.path === wsPath)
    if (ws) {
      ws.name = newName.trim() || path.basename(wsPath)
      saveStore()
      return true
    }
    return false
  })

  ipcMain.handle('workspace:set-last', (_, wsPath: string) => {
    store.lastWorkspace = wsPath
    const ws = store.workspaces.find((w) => w.path === wsPath)
    if (ws) ws.lastOpened = Date.now()
    saveStore()
    return true
  })

  ipcMain.handle('workspace:get-last', () => store.lastWorkspace)

  ipcMain.handle('workspace:reorder', (_, orderedPaths: string[]) => {
    const byPath = new Map(store.workspaces.map((w) => [w.path, w]))
    const reordered = orderedPaths.map((p) => byPath.get(p)).filter(Boolean) as typeof store.workspaces
    for (const ws of store.workspaces) {
      if (!reordered.find((r) => r.path === ws.path)) reordered.push(ws)
    }
    store.workspaces = reordered
    saveStore()
    return true
  })

  // ── Terminal ──
  ipcMain.handle('terminal:create', (_, workspacePath?: string) => createTerminal(workspacePath))

  ipcMain.on('terminal:write', (_, { id, data }: { id: number; data: string }) => {
    getTerminal(id)?.pty.write(data)
  })

  ipcMain.on('terminal:resize', (_, { id, cols, rows }: { id: number; cols: number; rows: number }) => {
    try { getTerminal(id)?.pty.resize(cols, rows) } catch (e) {
      console.warn(`[zeus] terminal:resize failed for id=${id}:`, e)
    }
  })

  ipcMain.handle('terminal:kill', (_, id: number) => killTerminal(id))

  // ── Claude CLI ──
  ipcMain.handle('claude:is-installed', () => isClaudeCodeInstalled())
  ipcMain.handle('claude:version', () => getClaudeCodeVersion())
  ipcMain.handle('claude:models', () => getClaudeModelAliases())
  ipcMain.handle('claude:check-latest', () => checkLatestClaudeVersion())
  ipcMain.handle('claude:update', () => updateClaudeCode())

  // ── IDE ──
  ipcMain.handle('ide:list', () => detectInstalledIDEs())

  ipcMain.handle('ide:open', (_, { ideCmd, workspacePath }: { ideCmd: string; workspacePath: string }) => {
    const allowedCmds = new Set(IDE_LIST.map((ide) => ide.cmd))
    if (!allowedCmds.has(ideCmd)) return { success: false, error: `Unknown IDE command: ${ideCmd}` }
    try {
      const { spawn } = require('node:child_process')
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
    saveStore()
    return true
  })

  // ── System ──
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
        try { packageName = JSON.parse(fs.readFileSync(path.join(dirPath, 'package.json'), 'utf-8')).name } catch { /* ignore */ }
      }
      return { name: path.basename(dirPath), path: dirPath, hasGit, hasPackageJson, packageName }
    } catch { return null }
  })

  // ── Claude Config / Skills / MCP ──
  ipcMain.handle('claude-config:read', () => readClaudeConfig())
  ipcMain.handle('claude-config:write', (_, config: object) => writeClaudeConfig(config))
  ipcMain.handle('claude-config:read-project', (_, wsPath: string) => readProjectClaudeConfig(wsPath))
  ipcMain.handle('claude-config:write-project', (_, wsPath: string, config: object) =>
    writeProjectClaudeConfig(wsPath, config)
  )

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

  // ── Skills ──
  ipcMain.handle('skills:scan', (_, wsPath: string) => scanCustomSkills(wsPath))

  // ── Files / Markdown ──
  ipcMain.handle('files:list-md', (_, dirPath: string) => listMarkdownFiles(dirPath))
  ipcMain.handle('files:read', (_, filePath: string) => readFileContent(filePath, store))
  ipcMain.handle('files:write', (_, filePath: string, content: string) => writeFileContent(filePath, content, store))

  // ── Git ──
  ipcMain.handle('git:diff', (_, workspacePath: string) => getGitDiff(workspacePath))
  ipcMain.handle('git:diff-file', (_, workspacePath: string, filePath: string) => getGitDiffFile(workspacePath, filePath))
  ipcMain.handle('git:changed-files', (_, workspacePath: string) => getGitChangedFiles(workspacePath))

  // ── Saved Claude Sessions ──
  ipcMain.handle('claude-session:list-saved', (_, workspacePath: string) => {
    const sessions = store.savedSessions ?? []
    return sessions.filter((s) => s.workspacePath === workspacePath).sort((a, b) => b.lastUsed - a.lastUsed)
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
    // Keep max 50 per workspace
    const byWs = store.savedSessions.filter((s) => s.workspacePath === session.workspacePath)
    if (byWs.length > 50) {
      const oldest = byWs.sort((a, b) => a.lastUsed - b.lastUsed)[0]
      store.savedSessions = store.savedSessions.filter((s) => s.sessionId !== oldest.sessionId)
    }
    saveStore()
    return true
  })

  ipcMain.handle('claude-session:delete-saved', (_, sessionId: string) => {
    if (!store.savedSessions) return true
    store.savedSessions = store.savedSessions.filter((s) => s.sessionId !== sessionId)
    saveStore()
    return true
  })

  ipcMain.handle('claude-session:read-transcript', (_, sessionId: string, workspacePath: string) => {
    return readClaudeTranscript(sessionId, workspacePath)
  })

  // ── Claude Session (headless -p mode) ──
  ipcMain.handle(
    'claude-session:send',
    (_, conversationId: string, prompt: string, cwd: string, model?: string, resumeSessionId?: string) => {
      return spawnClaudeSession(conversationId, prompt, cwd, model, resumeSessionId)
    }
  )

  ipcMain.handle('claude-session:abort', (_, conversationId: string) => {
    const session = getSession(conversationId)
    if (session?.process) {
      if (session.stdinReady && session.process.stdin && !session.process.stdin.destroyed) {
        try { session.process.stdin.end() } catch { /* ignore */ }
        session.stdinReady = false
      }
      session.process.kill('SIGINT')
    }
    return true
  })

  ipcMain.handle('claude-session:respond', (_, conversationId: string, response: string) => {
    const session = getSession(conversationId)
    if (!session) return false

    // Primary: write directly to stdin
    if (session.stdinReady && session.process?.stdin && !session.process.stdin.destroyed) {
      console.log(`[zeus] Responding to prompt [${conversationId}] via stdin: "${response}"`)
      session.process.stdin.write(response + '\n')
      return true
    }

    // Fallback: abort + re-spawn with --resume
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

  ipcMain.handle('claude-session:close', (_, conversationId: string) => {
    const session = getSession(conversationId)
    if (session?.process) {
      try {
        if (session.stdinReady && session.process.stdin && !session.process.stdin.destroyed) {
          session.process.stdin.end()
        }
        session.process.kill('SIGINT')
      } catch { /* ignore */ }
    }
    deleteSession(conversationId)
    return true
  })
}

// ── Lifecycle ──────────────────────────────────────────────────────────────────

function shutdownAll(): void {
  killAllTerminals()
  killAllClaudeSessions()
}

app.whenReady().then(() => {
  const pty = require('node-pty')
  initStore()
  initTerminal(pty, () => mainWindow)
  initClaudeSession(() => mainWindow)
  registerIPC()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  shutdownAll()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  shutdownAll()
  flushStore()
})
