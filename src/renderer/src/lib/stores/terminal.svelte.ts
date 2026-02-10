import type { TerminalSession, TerminalSize } from '../types/index.js'

// Max commands to keep in per-session history (oldest are dropped)
const MAX_HISTORY = 200

// ── Terminal Store (Svelte 5 runes) ────────────────────────────────────────────

/** Per-workspace snapshot of terminal tab state */
interface TerminalSnapshot {
  sessions: TerminalSession[]
  activeId: number | null
}

class TerminalStore {
  sessions = $state<TerminalSession[]>([])
  activeId = $state<number | null>(null)

  activeSession = $derived(
    this.activeId !== null ? this.sessions.find((s) => s.id === this.activeId) ?? null : null
  )

  /** Workspace-scoped snapshots: workspacePath → snapshot */
  private _snapshots = new Map<string, TerminalSnapshot>()
  private _currentWorkspace: string | null = null

  private _unsubData: (() => void) | null = null
  private _unsubExit: (() => void) | null = null
  private _resizeTimer: ReturnType<typeof setTimeout> | null = null

  /** Start listening for PTY events. Call once on mount.
   *  [A4] The callbacks appear to be no-ops, but calling onData/onExit is
   *  required to register the IPC listeners in preload (which does the actual
   *  xterm.write). Without calling these, no data flows to xterm. */
  listen() {
    this._unsubData = window.zeus.terminal.onData(() => { /* preload handles xterm.write */ })
    this._unsubExit = window.zeus.terminal.onExit(({ id }) => {
      // Auto-remove the session when the PTY process exits (from current view)
      this.sessions = this.sessions.filter((s) => s.id !== id)
      if (this.activeId === id) {
        this.activeId = this.sessions.length > 0 ? this.sessions[this.sessions.length - 1].id : null
      }
      // Also clean up from any workspace snapshots
      for (const [key, snap] of this._snapshots) {
        const hadSession = snap.sessions.some((s) => s.id === id)
        if (hadSession) {
          snap.sessions = snap.sessions.filter((s) => s.id !== id)
          if (snap.activeId === id) {
            snap.activeId = snap.sessions.length > 0 ? snap.sessions[snap.sessions.length - 1].id : null
          }
          if (snap.sessions.length === 0) this._snapshots.delete(key)
        }
      }
    })
  }

  /** Stop listening. Call on unmount. */
  unlisten() {
    this._unsubData?.()
    this._unsubExit?.()
  }

  /** Create a new terminal tab. */
  async create(workspacePath?: string): Promise<number> {
    const { id } = await window.zeus.terminal.create(workspacePath)

    const session: TerminalSession = {
      id,
      title: `Terminal ${id}`,
      workspacePath,
      history: [],
      historyIndex: -1
    }

    this.sessions = [...this.sessions, session]
    this.activeId = id
    return id
  }

  /** Attach xterm to a DOM element after it's rendered. */
  attach(termId: number, elementId: string): TerminalSize {
    return window.zeus.terminal.attach(termId, elementId)
  }

  /** Switch visible terminal. */
  switchTo(id: number) {
    this.activeId = id
  }

  /** Close and dispose a terminal session. */
  async close(id: number) {
    await window.zeus.terminal.kill(id)
    this.sessions = this.sessions.filter((s) => s.id !== id)
    if (this.activeId === id) {
      this.activeId = this.sessions.length > 0 ? this.sessions[this.sessions.length - 1].id : null
    }
  }

  /**
   * Switch workspace context: save current sessions, restore (or init) for the new workspace.
   * Terminal PTY processes remain alive — we just hide/show the tab lists.
   */
  switchWorkspace(workspacePath: string): void {
    // Save current workspace state
    if (this._currentWorkspace) {
      this._snapshots.set(this._currentWorkspace, {
        sessions: this.sessions,
        activeId: this.activeId
      })
    }

    this._currentWorkspace = workspacePath

    // Restore previous state for this workspace, or start fresh
    const snap = this._snapshots.get(workspacePath)
    if (snap) {
      this.sessions = snap.sessions
      this.activeId = snap.activeId
    } else {
      this.sessions = []
      this.activeId = null
    }
  }

  // ── Input ────────────────────────────────────────────────────────────────────

  /** Send text from InputBar to the PTY. Adds to history (capped). */
  sendInput(id: number, text: string) {
    if (!text.trim()) return
    // Add to history (deduplicate last entry, cap at MAX_HISTORY)
    const session = this.sessions.find((s) => s.id === id)
    if (session) {
      if (session.history[session.history.length - 1] !== text) {
        session.history = [...session.history, text]
        // Drop oldest entries when exceeding limit
        if (session.history.length > MAX_HISTORY) {
          session.history = session.history.slice(-MAX_HISTORY)
        }
      }
      session.historyIndex = -1
    }
    // Send to PTY — use \r (CR) not \n (LF).
    // Terminal apps in raw mode (like Claude Code / Ink) expect \r for Enter.
    // Shells in canonical mode have ICRNL which converts \r→\n, so \r works everywhere.
    window.zeus.terminal.writeToPty(id, text + '\r')
  }

  /** Send raw data to PTY (e.g. Ctrl+C = '\x03'). */
  sendRaw(id: number, data: string) {
    window.zeus.terminal.writeToPty(id, data)
  }

  /** Navigate history up. Returns the history entry or null. */
  historyUp(id: number): string | null {
    const session = this.sessions.find((s) => s.id === id)
    if (!session || session.history.length === 0) return null
    if (session.historyIndex === -1) {
      session.historyIndex = session.history.length - 1
    } else if (session.historyIndex > 0) {
      session.historyIndex--
    }
    return session.history[session.historyIndex] ?? null
  }

  /** Navigate history down. Returns the history entry or '' to clear. */
  historyDown(id: number): string | null {
    const session = this.sessions.find((s) => s.id === id)
    if (!session || session.historyIndex === -1) return null
    if (session.historyIndex < session.history.length - 1) {
      session.historyIndex++
      return session.history[session.historyIndex]
    } else {
      session.historyIndex = -1
      return ''
    }
  }

  // ── Display ──────────────────────────────────────────────────────────────────

  fitActive(): TerminalSize | null {
    if (this.activeId === null) return null
    return window.zeus.terminal.fit(this.activeId)
  }

  fitActiveDebounced(delay = 50) {
    if (this._resizeTimer) clearTimeout(this._resizeTimer)
    this._resizeTimer = setTimeout(() => this.fitActive(), delay)
  }

  focusActive() {
    if (this.activeId !== null) window.zeus.terminal.focus(this.activeId)
  }

  clearActive() {
    if (this.activeId !== null) window.zeus.terminal.clear(this.activeId)
  }

  /** Write data to PTY (legacy compatibility). */
  writeToPty(id: number, data: string) {
    window.zeus.terminal.writeToPty(id, data)
  }
}

export const terminalStore = new TerminalStore()
