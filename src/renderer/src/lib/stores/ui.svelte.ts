// ── UI Store (Svelte 5 runes) ──────────────────────────────────────────────────

export interface Toast {
  message: string
  type: 'info' | 'success' | 'error'
  id: number
}

export type ActiveViewType = 'terminal' | 'doc' | 'claude'

export type ThemeId = 'claude-code' | 'anthropic' | 'claude-dark'

export interface ThemeOption {
  id: ThemeId
  label: string
  desc: string
}

export const THEMES: ThemeOption[] = [
  { id: 'claude-code', label: 'Claude Code', desc: 'Dark terminal' },
  { id: 'anthropic',   label: 'Anthropic',   desc: 'Warm light' },
  { id: 'claude-dark', label: 'Claude Dark',  desc: 'Refined dark' },
]

export interface ModelOption {
  id: string      // value passed to --model
  label: string   // display name
  version: string // model version string
  desc: string    // short description
  group?: string  // optional grouping header
}

/** Model descriptions keyed by alias */
const MODEL_DESC: Record<string, { desc: string; group: string }> = {
  sonnet: { desc: 'Fast & balanced', group: 'Sonnet' },
  opus:   { desc: 'Most capable', group: 'Opus' },
  haiku:  { desc: 'Fastest & lightest', group: 'Haiku' },
}

/** Static fallback if dynamic fetch fails */
const FALLBACK_MODELS: ModelOption[] = [
  { id: 'sonnet', label: 'Sonnet', version: '4.5', desc: 'Fast & balanced', group: 'Sonnet' },
  { id: 'sonnet[1m]', label: 'Sonnet 1M', version: '4.5', desc: 'Extended 1M context', group: 'Sonnet' },
  { id: 'opus', label: 'Opus', version: '4.6', desc: 'Most capable', group: 'Opus' },
  { id: 'opus[1m]', label: 'Opus 1M', version: '4.6', desc: 'Extended 1M context', group: 'Opus' },
  { id: 'haiku', label: 'Haiku', version: '3.5', desc: 'Fastest & lightest', group: 'Haiku' },
]

/** Reactive model list — populated dynamically from Claude Code */
export let AVAILABLE_MODELS = $state<ModelOption[]>([...FALLBACK_MODELS])

/** Fetch model aliases from Claude Code and build AVAILABLE_MODELS */
async function loadModelsFromClaudeCode(): Promise<void> {
  try {
    const aliases: { alias: string; fullName: string; version: string }[] =
      await window.zeus.claude.models()
    if (!aliases || aliases.length === 0) return

    const models: ModelOption[] = []
    for (const { alias, version } of aliases) {
      const label = alias.charAt(0).toUpperCase() + alias.slice(1)
      const meta = MODEL_DESC[alias] ?? { desc: '', group: label }
      models.push({
        id: alias,
        label,
        version,
        desc: meta.desc,
        group: meta.group
      })
      // Also add [1m] extended context variant
      models.push({
        id: `${alias}[1m]`,
        label: `${label} 1M`,
        version,
        desc: 'Extended 1M context',
        group: meta.group
      })
    }
    if (models.length > 0) {
      AVAILABLE_MODELS.length = 0
      AVAILABLE_MODELS.push(...models)
    }
  } catch { /* keep fallback */ }
}

class UIStore {
  sidebarCollapsed = $state(false)
  rightPanelOpen = $state(false)
  rightPanelTab = $state<'skills' | 'mcp' | 'docs'>('skills')
  ideModalOpen = $state(false)
  updateModalOpen = $state(false)
  settingsOpen = $state(false)
  toasts = $state<Toast[]>([])
  termSize = $state('')

  /** Which kind of tab is showing in the main content area */
  activeView = $state<ActiveViewType>('terminal')

  /** Active color theme */
  theme = $state<ThemeId>(
    (typeof localStorage !== 'undefined' && localStorage.getItem('zeus-theme') as ThemeId) || 'claude-code'
  )

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

  /** Change theme and persist */
  setTheme(id: ThemeId) {
    this.theme = id
    document.documentElement.setAttribute('data-theme', id)
    localStorage.setItem('zeus-theme', id)
  }

  /** Apply persisted theme on startup */
  applyTheme() {
    document.documentElement.setAttribute('data-theme', this.theme)
  }

  toggleSettings() {
    this.settingsOpen = !this.settingsOpen
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

  /** Load models from Claude Code and sync selected model from settings */
  async syncModelFromSettings() {
    if (this._modelSynced) return
    try {
      // Load dynamic model list first
      await loadModelsFromClaudeCode()

      const config = await window.zeus.claudeConfig.read()
      const model = (config as Record<string, unknown>).model
      if (typeof model === 'string' && model) {
        const known = AVAILABLE_MODELS.find((m) => m.id === model)
        if (known) {
          this.selectedModel = known.id
        } else {
          // Add as a custom entry and select it
          if (!AVAILABLE_MODELS.find((m) => m.id === model)) {
            const vMatch = model.match(/(\d+(?:-\d+)?)(?:-\d{8})?$/)
            const ver = vMatch ? vMatch[1].replace(/-/g, '.') : ''
            AVAILABLE_MODELS.unshift({ id: model, label: model, version: ver, desc: 'From settings', group: 'Custom' })
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
      const config = await window.zeus.claudeConfig.read()
      config.model = modelId
      await window.zeus.claudeConfig.write(config)
    } catch { /* ignore */ }
  }
}

export const uiStore = new UIStore()
