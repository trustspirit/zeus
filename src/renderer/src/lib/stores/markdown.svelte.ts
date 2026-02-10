import type { MarkdownFile, DocTab } from '../types/index.js'
import { uiStore } from './ui.svelte.js'

// ── Markdown / Docs Store ─────────────────────────────────────────────────────
// Memory optimization: only the *active* tab's content is kept in memory.
// Background tabs store metadata (file info) but content is set to null.
// When switching tabs, the active tab's content is loaded from disk.

/** Per-workspace snapshot of doc tab state */
interface DocSnapshot {
  files: MarkdownFile[]
  openTabs: DocTab[]
  activeDocId: string | null
}

class MarkdownStore {
  /** All markdown files in the workspace (flat, sorted by dir then name) */
  files = $state<MarkdownFile[]>([])
  loading = $state(false)

  /** Open doc tabs in the main content area */
  openTabs = $state<DocTab[]>([])
  activeDocId = $state<string | null>(null)

  /** Workspace-scoped snapshots: workspacePath → snapshot */
  private _snapshots = new Map<string, DocSnapshot>()
  private _currentWorkspace: string | null = null

  /** Derived: active doc tab */
  activeTab = $derived(
    this.activeDocId ? this.openTabs.find((t) => t.id === this.activeDocId) ?? null : null
  )

  /** Derived: files grouped by directory */
  groupedFiles = $derived.by(() => {
    const groups = new Map<string, MarkdownFile[]>()
    for (const f of this.files) {
      const dir = f.dir || '.'
      if (!groups.has(dir)) groups.set(dir, [])
      groups.get(dir)!.push(f)
    }
    return groups
  })

  /** Load all markdown files for a workspace */
  async loadFiles(dirPath: string) {
    this.loading = true
    try {
      this.files = await window.zeus.files.listMd(dirPath)
    } finally {
      this.loading = false
    }
  }

  /** Open a file as a doc tab in the main content area */
  async openFile(file: MarkdownFile) {
    // Check if already open
    const existing = this.openTabs.find((t) => t.id === file.path)
    if (existing) {
      // Reload content on switch (it was released from memory)
      await this._activateTab(existing.id)
      return
    }

    // Load content for the new active tab
    const content = (await window.zeus.files.read(file.path)) ?? '*(empty file)*'

    const tab: DocTab = {
      id: file.path,
      file,
      content
    }

    // Release content of previously active tab before adding new one
    this._releaseInactiveContent(tab.id)

    this.openTabs = [...this.openTabs, tab]
    this.activeDocId = tab.id
    uiStore.activeView = 'doc'
  }

  /** Switch to a doc tab — lazy-loads content from disk */
  async switchTo(id: string) {
    await this._activateTab(id)
  }

  /** Close a doc tab — releases its content */
  close(id: string) {
    const idx = this.openTabs.findIndex((t) => t.id === id)
    if (idx === -1) return

    this.openTabs = this.openTabs.filter((t) => t.id !== id)

    // If we closed the active tab, switch to another
    if (this.activeDocId === id) {
      if (this.openTabs.length > 0) {
        const newIdx = Math.min(idx, this.openTabs.length - 1)
        // Activate the adjacent tab (loads content)
        void this._activateTab(this.openTabs[newIdx].id)
      } else {
        this.activeDocId = null
        uiStore.activeView = 'terminal'
      }
    }
  }

  /** Reload the content of the active doc tab */
  async reloadActive() {
    if (!this.activeTab) return
    const content = (await window.zeus.files.read(this.activeTab.file.path)) ?? '*(empty file)*'
    this.openTabs = this.openTabs.map((t) =>
      t.id === this.activeDocId ? { ...t, content } : t
    )
  }

  /**
   * Switch workspace context: save current doc tabs, restore (or init) for the new workspace.
   */
  switchWorkspace(workspacePath: string): void {
    // Save current workspace state
    if (this._currentWorkspace) {
      this._snapshots.set(this._currentWorkspace, {
        files: this.files,
        openTabs: this.openTabs,
        activeDocId: this.activeDocId
      })
    }

    this._currentWorkspace = workspacePath

    // Restore previous state for this workspace, or start fresh
    const snap = this._snapshots.get(workspacePath)
    if (snap) {
      this.files = snap.files
      this.openTabs = snap.openTabs
      this.activeDocId = snap.activeDocId
    } else {
      this.files = []
      this.openTabs = []
      this.activeDocId = null
    }
  }

  /** Clear all state (e.g. when workspace changes) */
  reset() {
    this.files = []
    this.openTabs = []
    this.activeDocId = null
    if (uiStore.activeView === 'doc') {
      uiStore.activeView = 'terminal'
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /** Release content of all tabs except the given active id */
  private _releaseInactiveContent(activeId: string) {
    this.openTabs = this.openTabs.map((t) =>
      t.id !== activeId ? { ...t, content: null } : t
    )
  }

  /** Activate a tab: load its content, release others */
  private async _activateTab(id: string) {
    const tab = this.openTabs.find((t) => t.id === id)
    if (!tab) return

    // Load content if not already present (was released)
    if (!tab.content) {
      const content = (await window.zeus.files.read(tab.file.path)) ?? '*(empty file)*'
      this.openTabs = this.openTabs.map((t) =>
        t.id === id ? { ...t, content } : t
      )
    }

    // Release content of other tabs
    this._releaseInactiveContent(id)

    this.activeDocId = id
    uiStore.activeView = 'doc'
  }
}

export const markdownStore = new MarkdownStore()
