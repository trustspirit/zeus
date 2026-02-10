import type { Workspace, DirInfo } from '../types/index.js'

// ── Workspace Store (Svelte 5 runes) ──────────────────────────────────────────

class WorkspaceStore {
  list = $state<Workspace[]>([])
  active = $state<Workspace | null>(null)
  activeDirInfo = $state<DirInfo | null>(null)

  async load() {
    this.list = await window.zeus.workspace.list()
  }

  async add(): Promise<Workspace | null> {
    const result = await window.zeus.workspace.add()
    if (!result) return null
    await this.load()
    const ws = this.list.find((w) => w.path === result.path) ?? null
    if (ws) await this.select(ws)
    return ws
  }

  async remove(wsPath: string) {
    await window.zeus.workspace.remove(wsPath)
    if (this.active?.path === wsPath) {
      this.active = null
      this.activeDirInfo = null
    }
    await this.load()
    // Select next available workspace if we just removed the active one
    if (!this.active && this.list.length > 0) {
      await this.select(this.list[0])
    }
  }

  async rename(wsPath: string, newName: string) {
    await window.zeus.workspace.rename(wsPath, newName)
    await this.load()
    // Update active workspace reference if it was renamed
    if (this.active?.path === wsPath) {
      const updated = this.list.find((w) => w.path === wsPath)
      if (updated) this.active = updated
    }
  }

  async select(ws: Workspace, silent = false) {
    // Skip if already the active workspace — avoids re-triggering effects
    if (this.active?.path === ws.path) return false

    this.active = ws
    await window.zeus.workspace.setLast(ws.path)
    this.activeDirInfo = await window.zeus.system.getDirInfo(ws.path)
    return !silent
  }

  /** Reorder workspaces via drag-and-drop. Persists to disk. */
  async reorder(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return
    const items = [...this.list]
    const [moved] = items.splice(fromIndex, 1)
    items.splice(toIndex, 0, moved)
    this.list = items
    await window.zeus.workspace.reorder(items.map((w) => w.path))
  }

  async restoreLast() {
    const lastPath = await window.zeus.workspace.getLast()
    if (!lastPath) return
    const ws = this.list.find((w) => w.path === lastPath)
    if (ws) await this.select(ws, true)
  }
}

export const workspaceStore = new WorkspaceStore()
