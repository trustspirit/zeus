<script lang="ts">
  import { claudeSessionStore } from '../stores/claude-session.svelte.js'
  import { workspaceStore } from '../stores/workspace.svelte.js'
  import { skillsStore } from '../stores/skills.svelte.js'
  import { markdownStore } from '../stores/markdown.svelte.js'
  import { terminalStore } from '../stores/terminal.svelte.js'
  import { uiStore, AVAILABLE_MODELS } from '../stores/ui.svelte.js'
  import IconAnthropic from './icons/IconAnthropic.svelte'

  let { ontoggleChanges }: { ontoggleChanges?: () => void } = $props()

  let inputEl: HTMLTextAreaElement
  let inputValue = $state('')
  let modelMenuOpen = $state(false)
  let isDragOver = $state(false)

  // ── Command history (derived from conversation messages) ──
  let historyIndex = $state(-1) // -1 = not browsing; 0 = most recent
  let savedDraft = $state('')   // saves current input when entering history mode
  let historyMenuOpen = $state(false)

  // Derive history from actual user messages in the active conversation (newest first)
  // - If displayContent exists (set by Zeus when a skill was used), show that
  // - If content is short enough to be actual typed input, show it
  // - Skip long messages without displayContent (likely resolved skill .md bodies from transcript)
  const MAX_TYPED_LENGTH = 500
  const inputHistory = $derived.by(() => {
    const conv = claudeSessionStore.activeConversation
    if (!conv) return []
    const items: string[] = []
    for (let i = conv.messages.length - 1; i >= 0; i--) {
      const m = conv.messages[i]
      if (m.role !== 'user') continue
      if (m.displayContent) {
        // Explicitly labelled (skill invocation via Zeus) — always include
        const text = m.displayContent.trim()
        if (text) items.push(text)
      } else {
        // Raw content — only include if it looks like actual typed input
        const text = m.content.trim()
        if (text && text.length <= MAX_TYPED_LENGTH) {
          items.push(text)
        }
      }
    }
    return items
  })

  // Reset history index when conversation changes
  $effect(() => {
    void claudeSessionStore.activeConversation?.id
    historyIndex = -1
    savedDraft = ''
  })

  function resizeTextarea() {
    requestAnimationFrame(() => {
      if (inputEl) {
        inputEl.style.height = 'auto'
        inputEl.style.height = Math.min(inputEl.scrollHeight, 150) + 'px'
      }
    })
  }

  function navigateHistory(direction: 'up' | 'down') {
    if (inputHistory.length === 0) return

    if (direction === 'up') {
      if (historyIndex === -1) {
        savedDraft = inputValue
        historyIndex = 0
      } else if (historyIndex < inputHistory.length - 1) {
        historyIndex++
      } else {
        return
      }
      inputValue = inputHistory[historyIndex]
    } else {
      if (historyIndex <= 0) {
        historyIndex = -1
        inputValue = savedDraft
        savedDraft = ''
      } else {
        historyIndex--
        inputValue = inputHistory[historyIndex]
      }
    }
    resizeTextarea()
  }

  function selectHistoryItem(idx: number) {
    inputValue = inputHistory[idx]
    historyIndex = -1
    savedDraft = ''
    historyMenuOpen = false
    requestAnimationFrame(() => {
      inputEl?.focus()
      resizeTextarea()
    })
  }

  function toggleHistoryMenu() {
    historyMenuOpen = !historyMenuOpen
  }

  // ── Command tag (chip) ──
  interface CommandTag {
    command: string   // e.g. /project:deploy — sent to Claude
    label: string     // display name for the chip
    kind: 'command' | 'skill' | 'agent' | 'builtin'
    filePath?: string // .md file path for custom skills (resolved on send)
  }
  let commandTag = $state<CommandTag | null>(null)

  function removeTag() {
    commandTag = null
    requestAnimationFrame(() => inputEl?.focus())
  }

  // ── Attached files (drag & drop) ──
  interface AttachedFile {
    path: string
    name: string
  }
  let attachedFiles = $state<AttachedFile[]>([])

  function removeFile(idx: number) {
    attachedFiles = attachedFiles.filter((_, i) => i !== idx)
    requestAnimationFrame(() => inputEl?.focus())
  }

  function addFiles(files: AttachedFile[]) {
    // Deduplicate by path
    const existing = new Set(attachedFiles.map((f) => f.path))
    const newFiles = files.filter((f) => !existing.has(f.path))
    if (newFiles.length > 0) {
      attachedFiles = [...attachedFiles, ...newFiles]
    }
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    isDragOver = true
  }

  function handleDragLeave(e: DragEvent) {
    // Only close when leaving the input-bar itself
    const related = e.relatedTarget as HTMLElement | null
    const bar = (e.currentTarget as HTMLElement)
    if (!related || !bar.contains(related)) {
      isDragOver = false
    }
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault()
    isDragOver = false
    if (!e.dataTransfer) return

    const droppedFiles: AttachedFile[] = []
    for (const file of Array.from(e.dataTransfer.files)) {
      // Electron exposes file.path for local files
      const filePath = (file as File & { path?: string }).path
      if (filePath) {
        droppedFiles.push({ path: filePath, name: file.name })
      }
    }
    if (droppedFiles.length > 0) {
      addFiles(droppedFiles)
      requestAnimationFrame(() => inputEl?.focus())
    }
  }

  // ── Reload skills whenever the active workspace changes ──
  $effect(() => {
    const wsPath = workspaceStore.active?.path
    skillsStore.load(wsPath)
  })

  // ── Slash command autocomplete ──
  let slashMenuOpen = $state(false)
  let slashFilter = $state('')
  let slashSelectedIdx = $state(0)
  let slashMenuEl: HTMLDivElement | undefined = $state(undefined)

  interface SlashItem {
    command: string
    label: string
    desc: string
    kind: 'command' | 'skill' | 'agent' | 'builtin'
    scope: 'user' | 'project' | 'system'
    filePath?: string // absolute path to .md file (for custom skills)
  }

  /** Claude Code built-in slash commands */
  const BUILTIN_COMMANDS: SlashItem[] = [
    { command: '/compact', label: 'compact', desc: 'Compact conversation context to save tokens', kind: 'builtin', scope: 'system' },
    { command: '/clear', label: 'clear', desc: 'Clear conversation history and start fresh', kind: 'builtin', scope: 'system' },
    { command: '/config', label: 'config', desc: 'View or modify Claude Code configuration', kind: 'builtin', scope: 'system' },
    { command: '/cost', label: 'cost', desc: 'Show token usage and cost for this session', kind: 'builtin', scope: 'system' },
    { command: '/doctor', label: 'doctor', desc: 'Check Claude Code installation health', kind: 'builtin', scope: 'system' },
    { command: '/help', label: 'help', desc: 'Show available commands and usage info', kind: 'builtin', scope: 'system' },
    { command: '/init', label: 'init', desc: 'Initialize project with CLAUDE.md guide', kind: 'builtin', scope: 'system' },
    { command: '/login', label: 'login', desc: 'Switch authentication accounts', kind: 'builtin', scope: 'system' },
    { command: '/logout', label: 'logout', desc: 'Sign out of current account', kind: 'builtin', scope: 'system' },
    { command: '/mcp', label: 'mcp', desc: 'Manage MCP server connections and status', kind: 'builtin', scope: 'system' },
    { command: '/memory', label: 'memory', desc: 'Edit CLAUDE.md project memory file', kind: 'builtin', scope: 'system' },
    { command: '/model', label: 'model', desc: 'View or change the active Claude model', kind: 'builtin', scope: 'system' },
    { command: '/permissions', label: 'permissions', desc: 'View or modify tool permissions', kind: 'builtin', scope: 'system' },
    { command: '/review', label: 'review', desc: 'Review code changes or pull request', kind: 'builtin', scope: 'system' },
    { command: '/status', label: 'status', desc: 'Show current session status info', kind: 'builtin', scope: 'system' },
    { command: '/terminal-setup', label: 'terminal-setup', desc: 'Install shell integrations (Shift+Enter)', kind: 'builtin', scope: 'system' },
    { command: '/vim', label: 'vim', desc: 'Toggle vim keybinding mode', kind: 'builtin', scope: 'system' },
    { command: '/agents', label: 'agents', desc: 'Manage subagents for task delegation', kind: 'builtin', scope: 'system' },
    { command: '/bug', label: 'bug', desc: 'Report a bug with Claude Code', kind: 'builtin', scope: 'system' },
    { command: '/plugin', label: 'plugin', desc: 'Manage plugins and MCP integrations', kind: 'builtin', scope: 'system' },
  ]

  const allSlashItems = $derived.by((): SlashItem[] => {
    const items: SlashItem[] = []
    const wsPath = workspaceStore.active?.path
    // Custom user/project skills — filter by current workspace scope
    for (const skill of skillsStore.customSkills) {
      // Project-level skills: only show if they belong to the current workspace
      if (skill.scope === 'project' && wsPath && !skill.filePath.startsWith(wsPath)) {
        continue
      }
      const cmd = skillsStore.getSlashCommand(skill)
      items.push({
        command: cmd,
        label: skill.name,
        desc: skill.content.slice(0, 80),
        kind: skill.kind,
        scope: skill.scope,
        filePath: skill.filePath
      })
    }
    // Built-in commands after
    items.push(...BUILTIN_COMMANDS)
    return items
  })

  const filteredSlashItems = $derived.by((): SlashItem[] => {
    if (!slashFilter) return allSlashItems
    const q = slashFilter.toLowerCase()
    return allSlashItems.filter(
      (item) =>
        item.command.toLowerCase().includes(q) ||
        item.label.toLowerCase().includes(q)
    )
  })

  /** Detect / at input start and open menu (only when no tag is set) */
  function checkSlashTrigger() {
    if (commandTag) { slashMenuOpen = false; return }
    const val = inputValue
    if (val.startsWith('/')) {
      slashFilter = val.slice(1).split(' ')[0]
      if (!val.includes(' ')) {
        slashMenuOpen = true
        slashSelectedIdx = 0
        return
      }
    }
    slashMenuOpen = false
  }

  /** Select a slash item → set as tag chip, clear input text */
  function selectSlashItem(item: SlashItem) {
    commandTag = { command: item.command, label: item.label, kind: item.kind, filePath: item.filePath }
    inputValue = ''
    slashMenuOpen = false
    requestAnimationFrame(() => {
      if (inputEl) {
        inputEl.focus()
        resetHeight()
      }
    })
  }

  function handleSlashKeydown(e: KeyboardEvent): boolean {
    if (!slashMenuOpen || filteredSlashItems.length === 0) return false

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      slashSelectedIdx = (slashSelectedIdx + 1) % filteredSlashItems.length
      scrollSlashItemIntoView()
      return true
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      slashSelectedIdx = (slashSelectedIdx - 1 + filteredSlashItems.length) % filteredSlashItems.length
      scrollSlashItemIntoView()
      return true
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      selectSlashItem(filteredSlashItems[slashSelectedIdx])
      return true
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      slashMenuOpen = false
      return true
    }
    return false
  }

  function scrollSlashItemIntoView() {
    requestAnimationFrame(() => {
      if (slashMenuEl) {
        const item = slashMenuEl.querySelector('.slash-item.selected') as HTMLElement
        item?.scrollIntoView({ block: 'nearest' })
      }
    })
  }

  // ── Model menu ──
  const currentModel = $derived(
    AVAILABLE_MODELS.find((m) => m.id === uiStore.selectedModel) ??
    { id: uiStore.selectedModel, label: uiStore.selectedModel, version: '', desc: '' }
  )

  function selectModel(id: string) {
    uiStore.setModel(id)
    modelMenuOpen = false
  }

  function toggleModelMenu() {
    modelMenuOpen = !modelMenuOpen
  }

  function handleWindowClick(e: MouseEvent) {
    const target = e.target as HTMLElement
    if (modelMenuOpen && !target.closest('.model-selector')) {
      modelMenuOpen = false
    }
    if (slashMenuOpen && !target.closest('.slash-menu') && !target.closest('.input-field')) {
      slashMenuOpen = false
    }
    if (historyMenuOpen && !target.closest('.history-menu') && !target.closest('.history-btn')) {
      historyMenuOpen = false
    }
  }

  // ── Claude conversation state ──
  const claudeConv = $derived(claudeSessionStore.activeConversation)
  const hasActiveTarget = $derived(!!claudeConv)
  const isStreaming = $derived(claudeConv?.isStreaming ?? false)
  const canSend = $derived((inputValue.trim().length > 0 || !!commandTag || attachedFiles.length > 0))

  $effect(() => {
    const _ = claudeConv?.id
    void _
    if (hasActiveTarget && inputEl) {
      requestAnimationFrame(() => inputEl?.focus())
    }
  })

  /** Pick up prefill from uiStore — set as tag chip instead of raw text */
  $effect(() => {
    const seq = uiStore.prefillSeq
    const text = uiStore.inputPrefill
    void seq
    if (text && inputEl && hasActiveTarget) {
      uiStore.consumePrefill()
      const trimmed = text.trim()
      // If it looks like a slash command, convert to tag
      if (trimmed.startsWith('/')) {
        const match = allSlashItems.find((i) => i.command === trimmed)
        if (match) {
          commandTag = { command: match.command, label: match.label, kind: match.kind, filePath: match.filePath }
        } else {
          // Unknown slash command — still show as tag
          const parts = trimmed.slice(1).split(':')
          commandTag = { command: trimmed, label: parts[parts.length - 1] || trimmed, kind: 'command' }
        }
        inputValue = ''
      } else {
        inputValue = text
      }
      requestAnimationFrame(() => {
        if (inputEl) {
          inputEl.focus()
          inputEl.selectionStart = inputEl.selectionEnd = inputEl.value.length
          handleInput()
        }
      })
    }
  })

  /**
   * Handle built-in commands locally in Zeus.
   * Returns a translated prompt string if the command should still be sent to Claude,
   * or null if the command was fully handled locally.
   */
  function handleBuiltinCommand(cmd: string, args: string): string | null {
    switch (cmd) {
      case '/clear':
        // Clear current conversation messages
        if (claudeConv) {
          claudeConv.messages = []
          claudeConv.streamingContent = ''
          claudeConv.streamingBlocks = []
          claudeConv.streamingStatus = ''
          claudeConv.claudeSessionId = null
          claudeSessionStore.conversations = [...claudeSessionStore.conversations]
        }
        addSystemMessage('Conversation cleared.')
        return null

      case '/compact':
        // Start a fresh session (drop --resume) to effectively compact
        if (claudeConv) {
          claudeConv.claudeSessionId = null
          claudeSessionStore.conversations = [...claudeSessionStore.conversations]
        }
        addSystemMessage('Context compacted — starting fresh session on next message.')
        return null

      case '/model':
        // Open model selector
        modelMenuOpen = true
        addSystemMessage(`Current model: **${uiStore.selectedModel}**. Use the model selector to change.`)
        return null

      case '/mcp':
      case '/plugin':
        // Show MCP panel (plugins / MCP are managed in the same panel)
        uiStore.rightPanelTab = 'mcp'
        uiStore.rightPanelOpen = true
        addSystemMessage('Opened MCP panel to manage servers and plugins.')
        return null

      case '/memory':
        // Try to open CLAUDE.md in doc viewer
        openMemoryFile()
        return null

      case '/config':
        addSystemMessage(
          '**Configuration:**\n' +
          `- Model: \`${uiStore.selectedModel}\`\n` +
          `- Workspace: \`${workspaceStore.active?.path ?? 'none'}\`\n` +
          `- Settings: \`~/.claude/settings.json\`\n\n` +
          'Edit settings via the model selector or modify `~/.claude/settings.json` directly.'
        )
        return null

      case '/cost':
        addSystemMessage('Cost information is tracked per-session by Claude Code. Send a message to Claude to ask about current session costs.')
        return null

      case '/status':
        addSystemMessage(
          '**Session Status:**\n' +
          `- Session ID: \`${claudeConv?.claudeSessionId ?? 'new'}\`\n` +
          `- Model: \`${uiStore.selectedModel}\`\n` +
          `- Messages: ${claudeConv?.messages.length ?? 0}\n` +
          `- Workspace: \`${workspaceStore.active?.path ?? 'none'}\``
        )
        return null

      case '/help':
        addSystemMessage(
          '**Available Commands:**\n\n' +
          '**Zeus-native:**\n' +
          '- `/clear` — Clear conversation\n' +
          '- `/compact` — Start fresh session (compacts context)\n' +
          '- `/model` — Change Claude model\n' +
          '- `/mcp` / `/plugin` — Open MCP & plugins panel\n' +
          '- `/memory` — Open CLAUDE.md\n' +
          '- `/config` — Show configuration\n' +
          '- `/status` — Session info\n\n' +
          '**Sent to Claude:**\n' +
          '- `/review` — Review code changes\n' +
          '- `/init` — Initialize project with CLAUDE.md\n' +
          '- `/agents` — Manage subagents\n\n' +
          '**Custom commands** from your workspace\'s `.claude/commands/` are also available.\n\n' +
          'Type `/` to see all commands.'
        )
        return null

      case '/login':
      case '/logout':
      case '/doctor':
      case '/terminal-setup':
      case '/vim':
      case '/permissions':
      case '/bug':
        // Open a terminal tab and run `claude <subcommand>` interactively
        runInTerminal(cmd.slice(1), args)
        addSystemMessage(`Running \`claude ${cmd.slice(1)}\` in a terminal tab…`)
        return null

      // These are translated to prompts for Claude headless mode
      case '/review':
        return args
          ? `Review the following: ${args}`
          : 'Review the recent code changes in this repository. Look at the git diff and provide feedback.'
      case '/init':
        return args
          ? `Initialize this project: ${args}`
          : 'Initialize this project by creating a CLAUDE.md guide file that documents the project structure, conventions, and important details.'
      case '/agents':
        return args
          ? `About subagents: ${args}`
          : 'List and describe the available subagents and how to use them for task delegation.'

      default:
        // Unknown built-in — just send as-is (Claude may understand or error gracefully)
        return args ? `${cmd} ${args}` : cmd
    }
  }

  /** Add a local system message to the conversation */
  function addSystemMessage(content: string) {
    if (!claudeConv) return
    const msg = {
      id: `msg-${Date.now()}-system`,
      role: 'assistant' as const,
      content,
      timestamp: Date.now()
    }
    claudeConv.messages = [...claudeConv.messages, msg]
    claudeSessionStore.conversations = [...claudeSessionStore.conversations]
  }

  /** Open CLAUDE.md in the doc viewer */
  async function openMemoryFile() {
    const ws = workspaceStore.active
    if (!ws) {
      addSystemMessage('No workspace selected.')
      return
    }
    const claudeMdPath = `${ws.path}/CLAUDE.md`
    try {
      const content = await window.zeus.files.read(claudeMdPath)
      if (content !== null) {
        await markdownStore.openFile({
          name: 'CLAUDE.md',
          path: claudeMdPath,
          size: content.length,
          relativePath: 'CLAUDE.md',
          dir: '.'
        })
      } else {
        addSystemMessage('`CLAUDE.md` not found. Use `/init` to create one.')
      }
    } catch {
      addSystemMessage('`CLAUDE.md` not found. Use `/init` to create one.')
    }
  }

  /** Open a terminal tab and run `claude <subcommand>` interactively */
  async function runInTerminal(subcommand: string, args: string) {
    const cwd = workspaceStore.active?.path
    const id = await terminalStore.create(cwd)
    uiStore.activeView = 'terminal'

    // Wait for the terminal to be rendered and attached before sending input
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))

    // Attach xterm if not already done (App.svelte normally does this)
    try {
      const el = document.getElementById(`terminal-${id}`)
      if (el) terminalStore.attach(id, `terminal-${id}`)
    } catch { /* already attached */ }

    // Build the command: `claude <subcommand> [args]`
    const fullCmd = args ? `claude ${subcommand} ${args}` : `claude ${subcommand}`
    terminalStore.sendInput(id, fullCmd)
  }

  /**
   * Resolve a custom skill's .md content for sending to Claude Code.
   * Tries multiple strategies: commandTag.filePath, store lookup by command, store lookup by label.
   * Replaces $ARGUMENTS with user's additional text input.
   */
  async function resolveSkillContent(tag: CommandTag, userArgs: string): Promise<string | null> {
    // Strategy 1: direct filePath from tag
    // Strategy 2: lookup by command in skillsStore
    // Strategy 3: lookup by label/name in skillsStore
    const candidates: string[] = []
    if (tag.filePath) candidates.push(tag.filePath)

    const byCmd = skillsStore.customSkills.find(
      (s) => skillsStore.getSlashCommand(s) === tag.command
    )
    if (byCmd?.filePath && !candidates.includes(byCmd.filePath)) {
      candidates.push(byCmd.filePath)
    }

    const byName = skillsStore.customSkills.find(
      (s) => s.name === tag.label || s.name === tag.command.replace(/^\/[^:]+:/, '')
    )
    if (byName?.filePath && !candidates.includes(byName.filePath)) {
      candidates.push(byName.filePath)
    }

    // Try each candidate path
    for (const fp of candidates) {
      try {
        const content = await window.zeus.files.read(fp)
        if (content) {
          // Strip YAML frontmatter (---\n...\n---) — it's metadata, not prompt content
          // Claude Code CLI misinterprets leading "---" as an option flag
          let body = content.replace(/^---\n[\s\S]*?\n---\n?/, '').trim()

          // Replace $ARGUMENTS placeholder (used by Claude Code custom commands)
          let resolved = body.replace(/\$ARGUMENTS/g, userArgs || '')
          // If no $ARGUMENTS was present and there's user text, append it
          if (!body.includes('$ARGUMENTS') && userArgs) {
            resolved += '\n\n' + userArgs
          }
          return resolved.trim()
        }
      } catch { /* try next */ }
    }

    return null
  }

  async function send() {
    const text = inputValue.trim()
    if ((!text && !commandTag && attachedFiles.length === 0) || !claudeConv) return
    slashMenuOpen = false

    // Reset history browsing state
    historyIndex = -1
    savedDraft = ''

    // Handle built-in commands locally
    if (commandTag?.kind === 'builtin') {
      const translated = handleBuiltinCommand(commandTag.command, text)
      inputValue = ''
      commandTag = null
      attachedFiles = []
      resetHeight()
      if (translated === null) return // Fully handled locally
      // Send translated prompt to Claude
      claudeSessionStore.send(claudeConv.id, translated)
      return
    }

    // Build the actual prompt
    let prompt = ''
    let displayContent: string | undefined = undefined

    // Resolve custom skill: find the .md file, read its content, replace $ARGUMENTS
    if (commandTag) {
      const resolved = await resolveSkillContent(commandTag, text)
      if (resolved) {
        prompt = resolved
        // Show skill name + user instructions in UI, not the full .md content
        displayContent = text
          ? `${commandTag.command} ${text}`
          : commandTag.command
      } else if (commandTag.filePath) {
        // filePath exists but read failed — send descriptive text prompt instead of slash command
        prompt = text || `Run the skill: ${commandTag.label}`
      } else {
        // No filePath (e.g. typed slash command not in store) — send as text
        prompt = commandTag.command
        if (text) prompt += ' ' + text
      }
    } else {
      prompt = text
    }

    // Append file references so Claude Code knows about them
    if (attachedFiles.length > 0) {
      const fileRefs = attachedFiles.map((f) => f.path).join('\n')
      if (prompt) {
        prompt += '\n\nAttached files:\n' + fileRefs
      } else {
        prompt = 'Please look at these files:\n' + fileRefs
      }
      // Add file names to display content too
      const fileNames = attachedFiles.map((f) => f.name).join(', ')
      if (displayContent) {
        displayContent += `\n📎 ${fileNames}`
      }
    }

    claudeSessionStore.send(claudeConv.id, prompt.trim(), displayContent)
    inputValue = ''
    commandTag = null
    attachedFiles = []
    resetHeight()
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!hasActiveTarget) return

    // Slash menu captures navigation keys first
    if (handleSlashKeydown(e)) return

    // Arrow Up/Down for command history when input is empty or single-line
    if (e.key === 'ArrowUp' && !e.shiftKey && !commandTag) {
      // Only navigate history if cursor is at position 0 or input is empty
      const cursorAtStart = inputEl && inputEl.selectionStart === 0 && inputEl.selectionEnd === 0
      if (inputValue === '' || cursorAtStart) {
        e.preventDefault()
        navigateHistory('up')
        return
      }
    }
    if (e.key === 'ArrowDown' && !e.shiftKey && !commandTag) {
      // Only navigate history if browsing history
      if (historyIndex >= 0) {
        const cursorAtEnd = inputEl && inputEl.selectionStart === inputValue.length
        if (cursorAtEnd || inputValue === inputHistory[historyIndex]) {
          e.preventDefault()
          navigateHistory('down')
          return
        }
      }
    }

    // Escape closes history menu
    if (e.key === 'Escape' && historyMenuOpen) {
      e.preventDefault()
      historyMenuOpen = false
      return
    }

    // Backspace on empty input removes the tag
    if (e.key === 'Backspace' && commandTag && inputValue === '') {
      e.preventDefault()
      removeTag()
      return
    }

    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault()
      send()
      return
    }

    if (e.key === 'c' && e.ctrlKey && claudeConv) {
      e.preventDefault()
      claudeSessionStore.abort(claudeConv.id)
      inputValue = ''
      commandTag = null
      attachedFiles = []
      resetHeight()
      return
    }
  }

  function handleInput() {
    if (!inputEl) return
    inputEl.style.height = 'auto'
    inputEl.style.height = Math.min(inputEl.scrollHeight, 150) + 'px'
    checkSlashTrigger()
  }

  function resetHeight() {
    if (!inputEl) return
    inputEl.style.height = 'auto'
  }

  function kindClass(kind: string): string {
    if (kind === 'skill') return 'kind-skill'
    if (kind === 'agent') return 'kind-agent'
    if (kind === 'builtin') return 'kind-builtin'
    return 'kind-command'
  }

  export function focus() {
    inputEl?.focus()
  }

  /** Called externally (e.g. from ConversationView drop) to add files */
  export function handleFileDrop(e: DragEvent) {
    if (!e.dataTransfer) return
    const droppedFiles: AttachedFile[] = []
    for (const file of Array.from(e.dataTransfer.files)) {
      const filePath = (file as File & { path?: string }).path
      if (filePath) {
        droppedFiles.push({ path: filePath, name: file.name })
      }
    }
    if (droppedFiles.length > 0) {
      addFiles(droppedFiles)
      requestAnimationFrame(() => inputEl?.focus())
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<svelte:window onclick={handleWindowClick} />
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="input-bar"
  class:drag-over={isDragOver}
  role="region"
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
>
  <!-- Drag overlay -->
  {#if isDragOver}
    <div class="drop-overlay">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
      <span>Drop files here</span>
    </div>
  {/if}

  <!-- Command history popup -->
  {#if historyMenuOpen && inputHistory.length > 0}
    <div class="history-menu">
      <div class="history-header">
        <span>Recent Commands</span>
        <span class="history-count">{inputHistory.length}</span>
      </div>
      <div class="history-list">
        {#each inputHistory as item, idx (idx)}
          <button
            class="history-item"
            class:active={idx === historyIndex}
            onclick={() => selectHistoryItem(idx)}
          >
            <span class="history-idx">{idx + 1}</span>
            <span class="history-text">{item}</span>
          </button>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Slash command autocomplete -->
  {#if slashMenuOpen && filteredSlashItems.length > 0}
    {@const customItems = filteredSlashItems.filter(i => i.scope !== 'system')}
    {@const builtinItems = filteredSlashItems.filter(i => i.scope === 'system')}
    <div class="slash-menu" bind:this={slashMenuEl}>
      {#if customItems.length > 0}
        <div class="slash-header">Custom Commands</div>
        {#each customItems as item}
          {@const idx = filteredSlashItems.indexOf(item)}
          <button
            class="slash-item"
            class:selected={idx === slashSelectedIdx}
            onclick={() => selectSlashItem(item)}
            onmouseenter={() => { slashSelectedIdx = idx }}
          >
            <span class="slash-cmd">{item.command}</span>
            <span class="slash-badge {kindClass(item.kind)}">{item.kind}</span>
            <span class="slash-scope" class:scope-project={item.scope === 'project'} class:scope-user={item.scope === 'user'}>{item.scope === 'project' ? 'project' : 'user'}</span>
            {#if item.desc}
              <span class="slash-desc">{item.desc}</span>
            {/if}
          </button>
        {/each}
      {/if}
      {#if builtinItems.length > 0}
        <div class="slash-header">Built-in</div>
        {#each builtinItems as item}
          {@const idx = filteredSlashItems.indexOf(item)}
          <button
            class="slash-item"
            class:selected={idx === slashSelectedIdx}
            onclick={() => selectSlashItem(item)}
            onmouseenter={() => { slashSelectedIdx = idx }}
          >
            <span class="slash-cmd">{item.command}</span>
            {#if item.desc}
              <span class="slash-desc">{item.desc}</span>
            {/if}
          </button>
        {/each}
      {/if}
    </div>
  {/if}

  <!-- Attached file chips -->
  {#if attachedFiles.length > 0}
    <div class="file-chips">
      {#each attachedFiles as file, idx (file.path)}
        <div class="file-chip">
          <svg class="file-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          <span class="file-name" title={file.path}>{file.name}</span>
          <button class="file-remove" onclick={() => removeFile(idx)} title="Remove file">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      {/each}
    </div>
  {/if}

  <div class="input-row" class:streaming={isStreaming}>
    <!-- Command tag chip -->
    {#if commandTag}
      <div class="command-tag {kindClass(commandTag.kind)}">
        <span class="tag-label">{commandTag.command}</span>
        <button class="tag-remove" onclick={removeTag} title="Remove (Backspace)">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    {/if}

    <textarea
      bind:this={inputEl}
      bind:value={inputValue}
      class="input-field"
      placeholder={commandTag ? 'Add instructions...' : attachedFiles.length > 0 ? 'Ask about these files...' : 'Ask Claude... (type / for commands)'}
      rows="1"
      oninput={handleInput}
      onkeydown={handleKeydown}
      spellcheck="false"
      autocomplete="off"
    ></textarea>

    {#if isStreaming && !canSend}
      <button
        class="send-btn abort"
        onclick={() => claudeConv && claudeSessionStore.abort(claudeConv.id)}
        title="Stop (Ctrl+C)"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
      </button>
    {:else}
      <button
        class="send-btn"
        class:active={canSend}
        onclick={send}
        disabled={!canSend}
        title="Send (Enter)"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
      </button>
    {/if}
  </div>

  <div class="hints">
    <div class="model-selector">
      <button class="model-btn" onclick={toggleModelMenu} title="Select model">
        <IconAnthropic size={12} />
        <span>{currentModel.label}</span>
        {#if currentModel.version}
          <span class="model-ver">{currentModel.version}</span>
        {/if}
        <svg class="caret" class:open={modelMenuOpen} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      {#if modelMenuOpen}
        <div class="model-menu">
          {#each AVAILABLE_MODELS as model (model.id)}
            <button
              class="model-option"
              class:active={model.id === uiStore.selectedModel}
              onclick={() => selectModel(model.id)}
            >
              <span class="model-name">{model.label}</span>
              {#if model.version}
                <span class="model-version">{model.version}</span>
              {/if}
              <span class="model-desc">{model.desc}</span>
              {#if model.id === uiStore.selectedModel}
                <svg class="check" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
              {/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>

    {#if inputHistory.length > 0}
      <button class="hint-btn history-btn" class:active={historyMenuOpen} onclick={toggleHistoryMenu} title="Command history (↑/↓)">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        History
      </button>
    {/if}
    <span class="hint"><kbd>/</kbd> commands</span>
    <span class="hint"><kbd>↑↓</kbd> history</span>
    <span class="hint"><kbd>Enter</kbd> send</span>
    <span class="hint"><kbd>Shift+Enter</kbd> newline</span>
    <span class="hint"><kbd>Ctrl+C</kbd> abort</span>
    {#if ontoggleChanges}
      <button class="hint-btn" onclick={ontoggleChanges} title="Toggle changed files">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
        Changes
      </button>
    {/if}
    {#if workspaceStore.active}
      <span class="hint ws">{workspaceStore.active.name}</span>
    {/if}
  </div>
</div>

<style>
  .input-bar {
    flex-shrink: 0;
    border-top: 1px solid var(--border);
    background: var(--bg-surface);
    padding: 12px 16px 8px;
    position: relative;
    transition: border-color 150ms ease;
  }
  .input-bar.drag-over {
    border-color: var(--blue);
  }

  /* ── Drop overlay ── */
  .drop-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    background: var(--blue-bg);
    border: 2px dashed var(--blue);
    border-radius: 12px;
    z-index: 300;
    color: var(--blue);
    font-size: 14px;
    font-weight: 600;
    pointer-events: none;
  }

  /* ── File chips ── */
  .file-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 0 0 8px;
  }
  .file-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 28px;
    padding: 0 6px 0 8px;
    border-radius: 7px;
    background: var(--blue-bg);
    border: 1px solid var(--blue-border);
    color: var(--blue);
    font-size: 12px;
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
    animation: tag-in 150ms ease;
  }
  .file-icon { flex-shrink: 0; opacity: 0.7; }
  .file-name {
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1;
  }
  .file-remove {
    display: flex; align-items: center; justify-content: center;
    width: 18px; height: 18px; border: none; border-radius: 4px;
    background: transparent; color: var(--blue); cursor: pointer;
    opacity: 0.6; transition: opacity 100ms ease, background 100ms ease;
    padding: 0;
  }
  .file-remove:hover {
    opacity: 1;
    background: var(--blue-bg);
  }

  .input-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 10px 12px;
    flex-wrap: wrap;
    transition: border-color 200ms ease, box-shadow 200ms ease;
  }
  .input-row:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-glow);
  }
  .input-row.streaming {
    border-color: var(--accent-border);
    animation: input-glow 2.5s ease-in-out infinite;
  }
  .input-row.streaming:focus-within {
    animation: input-glow 2.5s ease-in-out infinite;
  }
  @keyframes input-glow {
    0%, 100% {
      border-color: var(--accent-bg-hover);
      box-shadow: 0 0 0 1px var(--accent-bg-subtle);
    }
    50% {
      border-color: var(--accent-border-strong);
      box-shadow: 0 0 8px var(--accent-glow), 0 0 0 1px var(--accent-glow);
    }
  }

  /* ── Command tag chip ── */
  .command-tag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 26px;
    padding: 0 4px 0 10px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
    flex-shrink: 0;
    animation: tag-in 150ms ease;
  }
  @keyframes tag-in {
    from { opacity: 0; transform: scale(0.9); }
    to { opacity: 1; transform: scale(1); }
  }
  .command-tag.kind-command {
    background: var(--accent-bg);
    color: var(--accent);
    border: 1px solid var(--accent-border);
  }
  .command-tag.kind-skill {
    background: rgba(122, 190, 117, 0.12);
    color: var(--green-soft);
    border: 1px solid rgba(122, 190, 117, 0.25);
  }
  .command-tag.kind-agent {
    background: rgba(210, 150, 100, 0.12);
    color: var(--orange-warm);
    border: 1px solid rgba(210, 150, 100, 0.25);
  }
  .command-tag.kind-builtin {
    background: rgba(160, 160, 180, 0.1);
    color: var(--text-dim);
    border: 1px solid rgba(160, 160, 180, 0.2);
  }
  .tag-label {
    line-height: 1;
    white-space: nowrap;
  }
  .tag-remove {
    display: flex; align-items: center; justify-content: center;
    width: 18px; height: 18px; border: none; border-radius: 4px;
    background: transparent; color: inherit; cursor: pointer;
    opacity: 0.5; transition: opacity 100ms ease, background 100ms ease;
    padding: 0;
  }
  .tag-remove:hover {
    opacity: 1;
    background: rgba(255, 255, 255, 0.08);
  }

  .input-field {
    flex: 1; min-width: 80px;
    background: transparent; border: none; outline: none;
    color: var(--text-primary); font-size: 14px; line-height: 28px;
    font-family: var(--font-mono);
    resize: none; overflow-y: auto;
    max-height: 150px;
    padding: 0; margin: 0;
    scrollbar-width: thin;
  }
  .input-field::placeholder { color: var(--text-hint); }
  .input-field::-webkit-scrollbar { width: 4px; }
  .input-field::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

  .send-btn {
    width: 32px; height: 32px; border: none; border-radius: 8px;
    background: var(--border); color: var(--text-hint); cursor: default;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0; transition: all 150ms ease;
    align-self: flex-end;
  }
  .send-btn.active {
    background: var(--accent); color: var(--bg-deep); cursor: pointer;
  }
  .send-btn.active:hover { background: var(--accent-hover); }
  .send-btn.abort {
    background: var(--red); color: var(--bg-deep); cursor: pointer;
  }
  .send-btn.abort:hover { background: var(--red-hover); }

  /* ── Slash command menu ── */
  .slash-menu {
    position: absolute;
    bottom: 100%;
    left: 16px; right: 16px;
    max-height: 280px;
    overflow-y: auto;
    background: var(--bg-raised);
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    padding: 4px;
    box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.6);
    z-index: 200;
    margin-bottom: 4px;
    scrollbar-width: thin;
  }
  .slash-menu::-webkit-scrollbar { width: 4px; }
  .slash-menu::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

  .slash-header {
    padding: 6px 10px 4px;
    font-size: 10px;
    font-weight: 600;
    color: var(--text-hint);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .slash-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 10px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
    text-align: left;
    font-family: inherit;
    transition: background 80ms ease;
  }
  .slash-item:hover,
  .slash-item.selected {
    background: var(--border);
    color: var(--text-primary);
  }

  .slash-cmd {
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
    font-size: 13px;
    font-weight: 600;
    color: var(--accent);
    white-space: nowrap;
    flex-shrink: 0;
  }
  .slash-item.selected .slash-cmd,
  .slash-item:hover .slash-cmd {
    color: var(--accent-hover);
  }

  .slash-badge {
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    padding: 1px 5px;
    border-radius: 4px;
    flex-shrink: 0;
  }
  .slash-badge.kind-command { background: var(--blue-bg); color: var(--blue); }
  .slash-badge.kind-skill { background: var(--green-bg); color: var(--green-soft); }
  .slash-badge.kind-agent { background: rgba(210, 150, 100, 0.12); color: var(--orange-warm); }
  .slash-badge.kind-builtin { background: rgba(160, 160, 180, 0.1); color: var(--text-dim); }

  .slash-scope {
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    padding: 1px 5px;
    border-radius: 4px;
    flex-shrink: 0;
  }
  .slash-scope.scope-project { background: var(--blue-bg); color: var(--blue); }
  .slash-scope.scope-user { background: rgba(160, 160, 180, 0.08); color: var(--text-muted); }

  .slash-desc {
    font-size: 11px;
    color: var(--text-hint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  /* ── History menu ── */
  .history-menu {
    position: absolute;
    bottom: 100%;
    left: 16px; right: 16px;
    max-height: 300px;
    display: flex;
    flex-direction: column;
    background: var(--bg-raised);
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.6);
    z-index: 200;
    margin-bottom: 4px;
    overflow: hidden;
  }
  .history-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px 6px;
    font-size: 10px;
    font-weight: 600;
    color: var(--text-hint);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .history-count {
    font-size: 9px;
    background: var(--border);
    color: var(--text-muted);
    padding: 1px 6px;
    border-radius: 8px;
    font-weight: 600;
  }
  .history-list {
    overflow-y: auto;
    padding: 4px;
    scrollbar-width: thin;
  }
  .history-list::-webkit-scrollbar { width: 4px; }
  .history-list::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
  .history-item {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    width: 100%;
    padding: 7px 10px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
    text-align: left;
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
    font-size: 12px;
    line-height: 1.4;
    transition: background 80ms ease;
  }
  .history-item:hover,
  .history-item.active {
    background: var(--border);
  }
  .history-idx {
    flex-shrink: 0;
    font-size: 10px;
    color: var(--text-hint);
    min-width: 16px;
    text-align: right;
    padding-top: 1px;
  }
  .history-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    word-break: break-word;
  }
  .history-btn.active {
    border-color: var(--text-muted);
    color: var(--text-primary);
    background: var(--bg-raised);
  }

  /* ── Hints ── */
  .hints {
    display: flex; align-items: center; gap: 12px;
    padding: 6px 4px 0; flex-wrap: wrap;
  }
  .hint {
    font-size: 10px; color: var(--text-hint);
  }
  .hint kbd {
    font-family: var(--font-mono);
    font-size: 10px; color: var(--text-hint);
    background: var(--bg-raised); padding: 1px 4px; border-radius: 3px;
    border: 1px solid var(--border);
  }
  .hint-btn {
    display: flex; align-items: center; gap: 4px;
    padding: 2px 8px; border: 1px solid var(--border); border-radius: 5px;
    background: transparent; color: var(--text-muted);
    font-size: 10px; cursor: pointer;
    font-family: var(--font-mono);
    transition: all 120ms ease;
  }
  .hint-btn:hover { border-color: var(--text-muted); color: var(--text-primary); background: var(--bg-raised); }

  .hint.ws {
    margin-left: auto;
    color: var(--text-hint);
    font-family: var(--font-mono);
  }

  /* ── Model Selector ── */
  .model-selector {
    position: relative;
  }
  .model-btn {
    display: flex; align-items: center; gap: 5px;
    padding: 3px 8px; border: 1px solid var(--border); border-radius: 6px;
    background: var(--bg-raised); color: var(--text-secondary);
    font-size: 11px; font-weight: 500; cursor: pointer;
    font-family: var(--font-mono);
    transition: all 120ms ease;
  }
  .model-btn:hover { border-color: var(--text-muted); color: var(--text-primary); }
  .model-btn .caret {
    transition: transform 150ms ease;
  }
  .model-btn .caret.open { transform: rotate(180deg); }

  .model-menu {
    position: absolute; bottom: calc(100% + 6px); left: 0;
    min-width: 200px;
    background: var(--bg-raised); border: 1px solid var(--border-strong);
    border-radius: 10px; padding: 4px;
    box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.5);
    z-index: 100;
  }
  .model-option {
    display: flex; align-items: center; gap: 8px;
    width: 100%; padding: 8px 10px; border: none; border-radius: 7px;
    background: transparent; color: var(--text-primary); cursor: pointer;
    text-align: left; font-family: inherit;
    transition: background 100ms ease;
  }
  .model-option:hover { background: var(--border); color: var(--text-primary); }
  .model-option.active { color: var(--accent); }

  .model-ver {
    font-size: 10px; color: var(--text-muted); font-weight: 400;
    font-family: var(--font-mono);
  }
  .model-btn:hover .model-ver { color: var(--text-secondary); }

  .model-name {
    font-size: 12px; font-weight: 600;
    font-family: var(--font-mono);
  }
  .model-version {
    font-size: 10px; color: var(--blue); font-weight: 500;
    background: var(--blue-bg); padding: 1px 5px; border-radius: 4px;
    font-family: var(--font-mono);
    flex-shrink: 0;
  }
  .model-option.active .model-version { color: var(--accent); background: var(--accent-glow); }
  .model-desc {
    font-size: 10px; color: var(--text-hint); flex: 1;
  }
  .model-option.active .model-desc { color: var(--text-muted); }
  .check { color: var(--accent); flex-shrink: 0; }
</style>
