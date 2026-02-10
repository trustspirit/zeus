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
}

export const AVAILABLE_MODELS: ModelOption[] = [
  { id: 'sonnet', label: 'Sonnet', desc: 'Fast & balanced' },
  { id: 'opus', label: 'Opus', desc: 'Most capable' },
  { id: 'haiku', label: 'Haiku', desc: 'Fastest & lightest' }
]

class UIStore {
  sidebarCollapsed = $state(false)
  rightPanelOpen = $state(false)
  ideModalOpen = $state(false)
  updateModalOpen = $state(false)
  toasts = $state<Toast[]>([])
  termSize = $state('')

  /** Which kind of tab is showing in the main content area */
  activeView = $state<ActiveViewType>('terminal')

  /** Selected Claude model alias */
  selectedModel = $state<string>('sonnet')

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

  /** Prefill the active InputBar with text (e.g. a slash command). Adds trailing space. */
  prefillInput(text: string) {
    this.inputPrefill = text.endsWith(' ') ? text : text + ' '
    this._prefillSeq++
  }

  /** Called by InputBar after consuming the prefill */
  consumePrefill() {
    this.inputPrefill = null
  }
}

export const uiStore = new UIStore()
