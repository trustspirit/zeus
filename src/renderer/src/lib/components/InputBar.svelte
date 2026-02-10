<script lang="ts">
  import { claudeSessionStore } from '../stores/claude-session.svelte.js'
  import { workspaceStore } from '../stores/workspace.svelte.js'
  import { skillsStore } from '../stores/skills.svelte.js'
  import { markdownStore } from '../stores/markdown.svelte.js'
  import { terminalStore } from '../stores/terminal.svelte.js'
  import { uiStore, AVAILABLE_MODELS } from '../stores/ui.svelte.js'
  import IconClaude from './icons/IconClaude.svelte'
  import IconAnthropic from './icons/IconAnthropic.svelte'

  let { ontoggleChanges }: { ontoggleChanges?: () => void } = $props()

  let inputEl: HTMLTextAreaElement
  let inputValue = $state('')
  let modelMenuOpen = $state(false)
  let isDragOver = $state(false)

  // ── Command tag (chip) ──
  interface CommandTag {
    command: string   // e.g. /project:deploy — sent to Claude
    label: string     // display name for the chip
    kind: 'command' | 'skill' | 'agent' | 'builtin'
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
    // Custom user/project skills first
    for (const skill of skillsStore.customSkills) {
      const cmd = skillsStore.getSlashCommand(skill)
      items.push({
        command: cmd,
        label: skill.name,
        desc: skill.content.slice(0, 80),
        kind: skill.kind,
        scope: skill.scope
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
    commandTag = { command: item.command, label: item.label, kind: item.kind }
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
          commandTag = { command: match.command, label: match.label, kind: match.kind }
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

  function send() {
    const text = inputValue.trim()
    if ((!text && !commandTag && attachedFiles.length === 0) || !claudeConv) return
    slashMenuOpen = false

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

    // Prepend slash command if tag exists
    if (commandTag) {
      prompt = commandTag.command
      if (text) prompt += ' ' + text
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
    }

    claudeSessionStore.send(claudeConv.id, prompt.trim())
    inputValue = ''
    commandTag = null
    attachedFiles = []
    resetHeight()
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!hasActiveTarget) return

    // Slash menu captures navigation keys first
    if (handleSlashKeydown(e)) return

    // Backspace on empty input removes the tag
    if (e.key === 'Backspace' && commandTag && inputValue === '') {
      e.preventDefault()
      removeTag()
      return
    }

    if (e.key === 'Enter' && !e.shiftKey) {
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
<div
  class="input-bar"
  class:drag-over={isDragOver}
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

  <div class="input-row">
    <div class="mode-icon">
      <IconClaude size={16} />
    </div>
    <span class="prompt">{'>'}</span>

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
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
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

    <span class="hint"><kbd>/</kbd> commands</span>
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
    border-top: 1px solid #3e4451;
    background: #21252b;
    padding: 12px 16px 8px;
    position: relative;
    transition: border-color 150ms ease;
  }
  .input-bar.drag-over {
    border-color: #61afef;
  }

  /* ── Drop overlay ── */
  .drop-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    background: rgba(112, 168, 224, 0.06);
    border: 2px dashed #61afef;
    border-radius: 12px;
    z-index: 300;
    color: #61afef;
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
    background: rgba(112, 168, 224, 0.1);
    border: 1px solid rgba(112, 168, 224, 0.2);
    color: #61afef;
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
    background: transparent; color: #61afef; cursor: pointer;
    opacity: 0.6; transition: opacity 100ms ease, background 100ms ease;
    padding: 0;
  }
  .file-remove:hover {
    opacity: 1;
    background: rgba(112, 168, 224, 0.15);
  }

  .input-row {
    display: flex;
    align-items: center;
    gap: 8px;
    background: #2c313a;
    border: 1px solid #3e4451;
    border-radius: 12px;
    padding: 10px 12px;
    flex-wrap: wrap;
    transition: border-color 200ms ease, box-shadow 200ms ease;
  }
  .input-row:focus-within {
    border-color: #c678dd;
    box-shadow: 0 0 0 2px rgba(198, 120, 221, 0.1);
  }

  .mode-icon {
    display: flex; align-items: center; justify-content: center;
    width: 28px; height: 28px; border-radius: 8px;
    background: rgba(198, 120, 221, 0.1); color: #c678dd; flex-shrink: 0;
  }

  .prompt {
    font-family: 'D2Coding', 'JetBrains Mono', 'SF Mono', monospace;
    font-size: 14px; font-weight: 600;
    color: #c678dd; flex-shrink: 0; line-height: 28px;
    user-select: none;
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
    background: rgba(198, 120, 221, 0.12);
    color: #c678dd;
    border: 1px solid rgba(198, 120, 221, 0.25);
  }
  .command-tag.kind-skill {
    background: rgba(122, 190, 117, 0.12);
    color: #7abe75;
    border: 1px solid rgba(122, 190, 117, 0.25);
  }
  .command-tag.kind-agent {
    background: rgba(210, 150, 100, 0.12);
    color: #d0966a;
    border: 1px solid rgba(210, 150, 100, 0.25);
  }
  .command-tag.kind-builtin {
    background: rgba(160, 160, 180, 0.1);
    color: #a0a0b0;
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
    color: #abb2bf; font-size: 14px; line-height: 28px;
    font-family: 'D2Coding', 'JetBrains Mono', 'SF Mono', 'Fira Code', monospace;
    resize: none; overflow-y: auto;
    max-height: 150px;
    padding: 0; margin: 0;
    scrollbar-width: thin;
  }
  .input-field::placeholder { color: #4b5263; }
  .input-field::-webkit-scrollbar { width: 4px; }
  .input-field::-webkit-scrollbar-thumb { background: #3e4451; border-radius: 2px; }

  .send-btn {
    width: 32px; height: 32px; border: none; border-radius: 8px;
    background: #3e4451; color: #4b5263; cursor: default;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0; transition: all 150ms ease;
  }
  .send-btn.active {
    background: #c678dd; color: #1e2127; cursor: pointer;
  }
  .send-btn.active:hover { background: #d19eee; }
  .send-btn.abort {
    background: #e06c75; color: #1e2127; cursor: pointer;
  }
  .send-btn.abort:hover { background: #e88990; }

  /* ── Slash command menu ── */
  .slash-menu {
    position: absolute;
    bottom: 100%;
    left: 16px; right: 16px;
    max-height: 280px;
    overflow-y: auto;
    background: #2c313a;
    border: 1px solid #4b5263;
    border-radius: 12px;
    padding: 4px;
    box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.6);
    z-index: 200;
    margin-bottom: 4px;
    scrollbar-width: thin;
  }
  .slash-menu::-webkit-scrollbar { width: 4px; }
  .slash-menu::-webkit-scrollbar-thumb { background: #3e4451; border-radius: 2px; }

  .slash-header {
    padding: 6px 10px 4px;
    font-size: 10px;
    font-weight: 600;
    color: #4b5263;
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
    color: #abb2bf;
    cursor: pointer;
    text-align: left;
    font-family: inherit;
    transition: background 80ms ease;
  }
  .slash-item:hover,
  .slash-item.selected {
    background: #3e4451;
    color: #abb2bf;
  }

  .slash-cmd {
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
    font-size: 13px;
    font-weight: 600;
    color: #c678dd;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .slash-item.selected .slash-cmd,
  .slash-item:hover .slash-cmd {
    color: #d19eee;
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
  .slash-badge.kind-command { background: rgba(112, 168, 224, 0.12); color: #61afef; }
  .slash-badge.kind-skill { background: rgba(122, 190, 117, 0.12); color: #7abe75; }
  .slash-badge.kind-agent { background: rgba(210, 150, 100, 0.12); color: #d0966a; }
  .slash-badge.kind-builtin { background: rgba(160, 160, 180, 0.1); color: #a0a0b0; }

  .slash-desc {
    font-size: 11px;
    color: #4b5263;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  /* ── Hints ── */
  .hints {
    display: flex; align-items: center; gap: 12px;
    padding: 6px 4px 0; flex-wrap: wrap;
  }
  .hint {
    font-size: 10px; color: #4b5263;
  }
  .hint kbd {
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
    font-size: 10px; color: #4b5263;
    background: #2c313a; padding: 1px 4px; border-radius: 3px;
    border: 1px solid #3e4451;
  }
  .hint-btn {
    display: flex; align-items: center; gap: 4px;
    padding: 2px 8px; border: 1px solid #3e4451; border-radius: 5px;
    background: transparent; color: #5c6370;
    font-size: 10px; cursor: pointer;
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
    transition: all 120ms ease;
  }
  .hint-btn:hover { border-color: #5c6370; color: #abb2bf; background: #2c313a; }

  .hint.ws {
    margin-left: auto;
    color: #4b5263;
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
  }

  /* ── Model Selector ── */
  .model-selector {
    position: relative;
  }
  .model-btn {
    display: flex; align-items: center; gap: 5px;
    padding: 3px 8px; border: 1px solid #3e4451; border-radius: 6px;
    background: #2c313a; color: #7f848e;
    font-size: 11px; font-weight: 500; cursor: pointer;
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
    transition: all 120ms ease;
  }
  .model-btn:hover { border-color: #5c6370; color: #abb2bf; }
  .model-btn .caret {
    transition: transform 150ms ease;
  }
  .model-btn .caret.open { transform: rotate(180deg); }

  .model-menu {
    position: absolute; bottom: calc(100% + 6px); left: 0;
    min-width: 200px;
    background: #2c313a; border: 1px solid #4b5263;
    border-radius: 10px; padding: 4px;
    box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.5);
    z-index: 100;
  }
  .model-option {
    display: flex; align-items: center; gap: 8px;
    width: 100%; padding: 8px 10px; border: none; border-radius: 7px;
    background: transparent; color: #abb2bf; cursor: pointer;
    text-align: left; font-family: inherit;
    transition: background 100ms ease;
  }
  .model-option:hover { background: #3e4451; color: #abb2bf; }
  .model-option.active { color: #c678dd; }

  .model-ver {
    font-size: 10px; color: #5c6370; font-weight: 400;
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
  }
  .model-btn:hover .model-ver { color: #7f848e; }

  .model-name {
    font-size: 12px; font-weight: 600;
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
  }
  .model-version {
    font-size: 10px; color: #61afef; font-weight: 500;
    background: rgba(97, 175, 239, 0.1); padding: 1px 5px; border-radius: 4px;
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
    flex-shrink: 0;
  }
  .model-option.active .model-version { color: #c678dd; background: rgba(198, 120, 221, 0.1); }
  .model-desc {
    font-size: 10px; color: #4b5263; flex: 1;
  }
  .model-option.active .model-desc { color: #5c6370; }
  .check { color: #c678dd; flex-shrink: 0; }
</style>
