import { contextBridge, ipcRenderer } from 'electron'
import path from 'node:path'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'

// Optional addons — gracefully degrade
let WebglAddon: typeof import('@xterm/addon-webgl').WebglAddon | null = null
let WebLinksAddon: typeof import('@xterm/addon-web-links').WebLinksAddon | null = null
try { WebglAddon = require('@xterm/addon-webgl').WebglAddon } catch {}
try { WebLinksAddon = require('@xterm/addon-web-links').WebLinksAddon } catch {}

// ── Local xterm instances (live in preload's isolated world) ───────────────────
interface LocalTerminal {
  xterm: Terminal
  fitAddon: FitAddon
  addons: { dispose(): void }[]  // track all addons for proper cleanup
}
const localTerminals = new Map<number, LocalTerminal>()

// ── Terminal Theme — Catppuccin Mocha ────────────────────────────────────────
// https://github.com/catppuccin/catppuccin — the most popular dev terminal palette
const THEME = {
  background: '#1e1e2e',
  foreground: '#cdd6f4',
  cursor: '#f5e0dc',
  cursorAccent: '#1e1e2e',
  selectionBackground: 'rgba(203, 166, 247, 0.28)',
  selectionForeground: '#cdd6f4',
  // Normal colours
  black: '#45475a',
  red: '#f38ba8',
  green: '#a6e3a1',
  yellow: '#f9e2af',
  blue: '#89b4fa',
  magenta: '#cba6f7',
  cyan: '#94e2d5',
  white: '#bac2de',
  // Bright colours
  brightBlack: '#585b70',
  brightRed: '#f38ba8',
  brightGreen: '#a6e3a1',
  brightYellow: '#f9e2af',
  brightBlue: '#89b4fa',
  brightMagenta: '#cba6f7',
  brightCyan: '#94e2d5',
  brightWhite: '#a6adc8'
} as const

// ── Expose typed API ───────────────────────────────────────────────────────────
contextBridge.exposeInMainWorld('zeus', {
  // ── Workspace ──
  workspace: {
    list: () => ipcRenderer.invoke('workspace:list'),
    add: () => ipcRenderer.invoke('workspace:add'),
    remove: (wsPath: string) => ipcRenderer.invoke('workspace:remove', wsPath),
    setLast: (wsPath: string) => ipcRenderer.invoke('workspace:set-last', wsPath),
    getLast: () => ipcRenderer.invoke('workspace:get-last'),
    reorder: (orderedPaths: string[]) => ipcRenderer.invoke('workspace:reorder', orderedPaths)
  },

  // ── Terminal ──
  terminal: {
    create: (workspacePath?: string) => ipcRenderer.invoke('terminal:create', workspacePath),

    attach: (termId: number, elementId: string) => {
      const container = document.getElementById(elementId)
      if (!container) throw new Error(`Element #${elementId} not found`)

      // scrollback 5000 is ~2-4 MB per terminal; 50000 was ~20-40 MB
      const xterm = new Terminal({
        fontSize: 14,
        fontFamily:
          "'D2Coding ligature', D2Coding, 'JetBrains Mono', 'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, monospace",
        lineHeight: 1.35,
        theme: THEME,
        cursorBlink: false,
        cursorStyle: 'bar',
        cursorInactiveStyle: 'none',
        allowTransparency: true,
        scrollback: 5000,
        tabStopWidth: 4,
        macOptionIsMeta: true,
        macOptionClickForcesSelection: true,
        drawBoldTextInBrightColors: true,
        minimumContrastRatio: 1,
        // Output-only: keyboard input is handled by InputBar
        disableStdin: true
      })

      const addons: { dispose(): void }[] = []

      const fitAddon = new FitAddon()
      xterm.loadAddon(fitAddon)
      addons.push(fitAddon)

      if (WebLinksAddon) {
        const wl = new WebLinksAddon((_: MouseEvent, uri: string) => {
          ipcRenderer.invoke('system:open-external', uri)
        })
        xterm.loadAddon(wl)
        addons.push(wl)
      }

      xterm.open(container)

      // GPU-accelerated rendering
      if (WebglAddon) {
        try {
          const webgl = new WebglAddon()
          webgl.onContextLoss(() => webgl.dispose())
          xterm.loadAddon(webgl)
          addons.push(webgl)
        } catch {
          /* canvas fallback */
        }
      }

      fitAddon.fit()

      // No xterm.onData — keyboard input goes through InputBar, not raw xterm
      xterm.onResize(({ cols, rows }) =>
        ipcRenderer.send('terminal:resize', { id: termId, cols, rows })
      )

      localTerminals.set(termId, { xterm, fitAddon, addons })
      ipcRenderer.send('terminal:resize', { id: termId, cols: xterm.cols, rows: xterm.rows })

      return { cols: xterm.cols, rows: xterm.rows }
    },

    writeToPty: (termId: number, data: string) =>
      ipcRenderer.send('terminal:write', { id: termId, data }),

    focus: (termId: number) => localTerminals.get(termId)?.xterm.focus(),

    fit: (termId: number) => {
      const t = localTerminals.get(termId)
      if (!t) return null
      t.fitAddon.fit()
      return { cols: t.xterm.cols, rows: t.xterm.rows }
    },

    clear: (termId: number) => localTerminals.get(termId)?.xterm.clear(),

    getSize: (termId: number) => {
      const t = localTerminals.get(termId)
      return t ? { cols: t.xterm.cols, rows: t.xterm.rows } : null
    },

    kill: async (termId: number) => {
      const local = localTerminals.get(termId)
      if (local) {
        // Dispose addons first (WebGL context, etc.) then xterm
        for (const addon of local.addons) {
          try { addon.dispose() } catch { /* already disposed */ }
        }
        local.addons.length = 0
        try { local.xterm.dispose() } catch { /* already disposed */ }
        localTerminals.delete(termId)
      }
      return ipcRenderer.invoke('terminal:kill', termId)
    },

    onData: (callback: (payload: { id: number; data: string }) => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: { id: number; data: string }) => {
        const local = localTerminals.get(payload.id)
        if (!local) return  // terminal already disposed — skip to avoid writing to dead xterm
        local.xterm.write(payload.data)
        callback(payload)
      }
      ipcRenderer.on('terminal:data', handler)
      return () => ipcRenderer.removeListener('terminal:data', handler)
    },

    onExit: (callback: (payload: { id: number; exitCode: number }) => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: { id: number; exitCode: number }) => {
        const local = localTerminals.get(payload.id)
        if (local) {
          local.xterm.writeln(`\r\n\x1B[90m[Process exited with code ${payload.exitCode}]\x1B[0m`)
        }
        callback(payload)
      }
      ipcRenderer.on('terminal:exit', handler)
      return () => ipcRenderer.removeListener('terminal:exit', handler)
    }
  },

  // ── Claude Code ──
  claude: {
    isInstalled: () => ipcRenderer.invoke('claude:is-installed'),
    version: () => ipcRenderer.invoke('claude:version'),
    update: () => ipcRenderer.invoke('claude:update')
  },

  // ── IDE ──
  ide: {
    list: () => ipcRenderer.invoke('ide:list'),
    open: (ideCmd: string, workspacePath: string) =>
      ipcRenderer.invoke('ide:open', { ideCmd, workspacePath }),
    getPreference: () => ipcRenderer.invoke('ide:get-preference'),
    setPreference: (ideId: string) => ipcRenderer.invoke('ide:set-preference', ideId)
  },

  // ── System ──
  system: {
    openExternal: (url: string) => ipcRenderer.invoke('system:open-external', url),
    revealInFinder: (p: string) => ipcRenderer.invoke('system:reveal-in-finder', p),
    getHome: () => ipcRenderer.invoke('system:get-home'),
    pathExists: (p: string) => ipcRenderer.invoke('system:path-exists', p),
    getDirInfo: (dirPath: string) => ipcRenderer.invoke('system:get-dir-info', dirPath)
  },

  // ── Claude Config / Skills / MCP ──
  claudeConfig: {
    read: () => ipcRenderer.invoke('claude-config:read'),
    write: (config: object) => ipcRenderer.invoke('claude-config:write', config),
    readProject: (wsPath: string) => ipcRenderer.invoke('claude-config:read-project', wsPath),
    writeProject: (wsPath: string, config: object) =>
      ipcRenderer.invoke('claude-config:write-project', wsPath, config)
  },

  skills: {
    scan: (wsPath: string) => ipcRenderer.invoke('skills:scan', wsPath)
  },

  mcp: {
    install: (pkg: string) => ipcRenderer.invoke('mcp:install', pkg)
  },

  // ── Files ──
  files: {
    listMd: (dirPath: string) => ipcRenderer.invoke('files:list-md', dirPath),
    read: (filePath: string) => ipcRenderer.invoke('files:read', filePath),
    write: (filePath: string, content: string) => ipcRenderer.invoke('files:write', filePath, content)
  },

  // ── Menu Actions ──
  onAction: (action: string, callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on(`action:${action}`, handler)
    return () => ipcRenderer.removeListener(`action:${action}`, handler)
  },

})
