/**
 * Terminal (PTY) management — spawns and manages pseudo-terminal sessions.
 */
import os from 'node:os'
import fs from 'node:fs'
import type { BrowserWindow } from 'electron'
import type * as PtyModule from 'node-pty'

// ── Types ──────────────────────────────────────────────────────────────────────

interface TermEntry {
  pty: PtyModule.IPty
  workspace: string
}

// ── State ──────────────────────────────────────────────────────────────────────

let _getWindow: () => BrowserWindow | null = () => null
let _pty: typeof PtyModule

const terminals = new Map<number, TermEntry>()
let nextTermId = 1

// ── Init ───────────────────────────────────────────────────────────────────────

/** Initialise the terminal module. Call once on startup. */
export function initTerminal(ptyModule: typeof PtyModule, getWindow: () => BrowserWindow | null): void {
  _pty = ptyModule
  _getWindow = getWindow
}

// ── Public API ─────────────────────────────────────────────────────────────────

function getShell(): string {
  if (process.platform === 'win32') return 'powershell.exe'
  return process.env.SHELL || '/bin/zsh'
}

export function createTerminal(workspacePath?: string): { id: number; cwd: string } {
  const id = nextTermId++
  const cwd =
    workspacePath && fs.existsSync(workspacePath) ? workspacePath : os.homedir()

  const shell = getShell()
  const shellArgs: string[] = process.platform === 'win32' ? [] : ['--login']

  const ptyProcess = _pty.spawn(shell, shellArgs, {
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

  const win = _getWindow()
  ptyProcess.onData((data) => {
    win?.webContents.send('terminal:data', { id, data })
  })

  ptyProcess.onExit(({ exitCode }) => {
    terminals.delete(id)
    _getWindow()?.webContents.send('terminal:exit', { id, exitCode })
  })

  return { id, cwd }
}

export function getTerminal(id: number) {
  return terminals.get(id)
}

export function killTerminal(id: number): boolean {
  const t = terminals.get(id)
  if (t) {
    t.pty.kill()
    terminals.delete(id)
  }
  return true
}

export function killAllTerminals(): void {
  for (const [, t] of terminals) {
    try { t.pty.kill() } catch { /* ignore */ }
  }
  terminals.clear()
}
