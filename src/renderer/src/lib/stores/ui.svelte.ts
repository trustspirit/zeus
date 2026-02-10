// ── UI Store (Svelte 5 runes) ──────────────────────────────────────────────────

export interface Toast {
  message: string
  type: 'info' | 'success' | 'error'
  id: number
}

export type ActiveViewType = 'terminal' | 'doc' | 'claude'

export interface ModelOption {
  id: string      // value passed to --model
  label: string   // display name
  desc: string    // short description
  group?: string  // optional grouping header
}

export const AVAILABLE_MODELS: ModelOption[] = [
  { id: 'sonnet', label: 'Sonnet', desc: 'Fast & balanced', group: 'Sonnet' },
  { id: 'sonnet[1m]', label: 'Sonnet 1M', desc: 'Extended 1M context', group: 'Sonnet' },
  { id: 'opus', label: 'Opus', desc: 'Most capable', group: 'Opus' },
  { id: 'opus[1m]', label: 'Opus 1M', desc: 'Extended 1M context', group: 'Opus' },
  { id: 'haiku', label: 'Haiku', desc: 'Fastest & lightest', group: 'Haiku' },
]

class UIStore {
  sidebarCollapsed = $state(false)
  rightPanelOpen = $state(false)
  rightPanelTab = $state<'skills' | 'mcp' | 'docs'>('skills')
  ideModalOpen = $state(false)
  updateModalOpen = $state(false)
  toasts = $state<Toast[]>([])
  termSize = $state('')

  /** Which kind of tab is showing in the main content area */
  activeView = $state<ActiveViewType>('terminal')

  /** Selected Claude model alias — synced from Claude settings on startup */
  selectedModel = $state<string>('sonnet')
  /** Whether we've loaded the model from Claude settings at least once */
  private _modelSynced = false

  /**
   * When set, the active InputBar should adopt this text and focus.
   * Incrementing `_prefillSeq` ensures reactivity even if the same text is set twice.
   */
  inputPrefill = $state<string | null>(null)
  private _prefillSeq = $state(0)
  get prefillSeq() { return this._prefillSeq }

  // Context menu
  contextMenuOpen = $state(false)
  contextMenuX = $state(0)
  contextMenuY = $state(0)
  contextMenuTarget = $state<string | null>(null)

  private _toastId = 0

  toggleSidebar() {
    this.sidebarCollapsed = !this.sidebarCollapsed
  }

  toggleRightPanel() {
    this.rightPanelOpen = !this.rightPanelOpen
  }

  showToast(message: string, type: Toast['type'] = 'info') {
    const id = ++this._toastId
    // Remove previous toast
    this.toasts = [{ message, type, id }]
    setTimeout(() => {
      this.toasts = this.toasts.filter((t) => t.id !== id)
    }, 3200)
  }

  openContextMenu(x: number, y: number, target: string) {
    this.contextMenuX = Math.min(x, window.innerWidth - 208)
    this.contextMenuY = Math.min(y, window.innerHeight - 228)
    this.contextMenuTarget = target
    this.contextMenuOpen = true
  }

  closeContextMenu() {
    this.contextMenuOpen = false
    this.contextMenuTarget = null
  }

  /** Prefill the active InputBar with text (e.g. a slash command). */
  prefillInput(text: string) {
    this.inputPrefill = text.trim()
    this._prefillSeq++
  }

  /** Called by InputBar after consuming the prefill */
  consumePrefill() {
    this.inputPrefill = null
  }

  /** Sync selected model from Claude Code's settings.json */
  async syncModelFromSettings() {
    if (this._modelSynced) return
    try {
      const config = await window.zeus.claudeConfig.read()
      const model = (config as Record<string, unknown>).model
      if (typeof model === 'string' && model) {
        const known = AVAILABLE_MODELS.find((m) => m.id === model)
        if (known) {
          this.selectedModel = known.id
        } else {
          // Add as a custom entry and select it
          if (!AVAILABLE_MODELS.find((m) => m.id === model)) {
            AVAILABLE_MODELS.unshift({ id: model, label: model, desc: 'From settings', group: 'Custom' })
          }
          this.selectedModel = model
        }
      }
      this._modelSynced = true
    } catch { /* ignore */ }
  }

  /** Set model and persist to Claude Code's settings.json */
  async setModel(modelId: string) {
    this.selectedModel = modelId
    try {
      const config = await window.zeus.claudeConfig.read() as Record<string, unknown>
      config.model = modelId
      await window.zeus.claudeConfig.write(config as object)
    } catch { /* ignore */ }
  }
}

export const uiStore = new UIStore()
