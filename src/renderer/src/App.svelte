<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte'
  import { workspaceStore } from './lib/stores/workspace.svelte.js'
  import { terminalStore } from './lib/stores/terminal.svelte.js'
  import { claudeSessionStore } from './lib/stores/claude-session.svelte.js'
  import { claudeStore } from './lib/stores/claude.svelte.js'
  import { ideStore } from './lib/stores/ide.svelte.js'
  import { uiStore } from './lib/stores/ui.svelte.js'

  import { markdownStore } from './lib/stores/markdown.svelte.js'

  import Sidebar from './lib/components/Sidebar.svelte'
  import Toolbar from './lib/components/Toolbar.svelte'
  import TerminalArea from './lib/components/TerminalArea.svelte'
  import ConversationView from './lib/components/ConversationView.svelte'
  import DocViewer from './lib/components/DocViewer.svelte'
  import WelcomeScreen from './lib/components/WelcomeScreen.svelte'
  import StatusBar from './lib/components/StatusBar.svelte'
  import RightPanel from './lib/components/RightPanel.svelte'
  // IDEModal replaced by IDEDropdown in Toolbar
  import UpdateModal from './lib/components/UpdateModal.svelte'
  import ContextMenu from './lib/components/ContextMenu.svelte'
  import Toast from './lib/components/Toast.svelte'
  import SettingsPanel from './lib/components/SettingsPanel.svelte'

  /** Show welcome only when nothing is open */
  const hasContent = $derived(
    terminalStore.sessions.length > 0 ||
    claudeSessionStore.conversations.length > 0 ||
    markdownStore.openTabs.length > 0
  )

  let unsubs: Array<() => void> = []

  onMount(async () => {
    // Apply persisted theme immediately
    uiStore.applyTheme()

    await Promise.all([
      workspaceStore.load(),
      claudeStore.check(),
      ideStore.load(),
      uiStore.syncModelFromSettings()
    ])

    await workspaceStore.restoreLast()
    terminalStore.listen()
    claudeSessionStore.listen()

    // Initialize workspace-scoped tabs for the active workspace
    if (workspaceStore.active) {
      const wsPath = workspaceStore.active.path
      claudeSessionStore.switchWorkspace(wsPath)
      terminalStore.switchWorkspace(wsPath)
      markdownStore.switchWorkspace(wsPath)
      await claudeSessionStore.loadSaved(wsPath)
      if (claudeStore.installed) {
        launchClaudeConversation(wsPath)
      }
    }

    unsubs.push(
      window.zeus.onAction('new-terminal', () => newTerminal()),
      window.zeus.onAction('run-claude', () => runClaude()),
      window.zeus.onAction('clear-terminal', () => terminalStore.clearActive())
    )
  })

  onDestroy(() => {
    terminalStore.unlisten()
    claudeSessionStore.unlisten()
    unsubs.forEach((fn) => fn())
  })

  // ── Actions ──────────────────────────────────────────────────────────────────

  /** Wait for Svelte DOM flush + one extra animation frame for layout */
  async function waitForDom(): Promise<void> {
    await tick()
    await new Promise<void>((r) => requestAnimationFrame(() => r()))
  }

  async function newTerminal(wsPath?: string) {
    const cwd = wsPath ?? workspaceStore.active?.path
    uiStore.activeView = 'terminal'
    const id = await terminalStore.create(cwd)
    // Svelte must render <div id="terminal-{id}"> before we attach xterm
    await waitForDom()
    try {
      const size = terminalStore.attach(id, `terminal-${id}`)
      uiStore.termSize = `${size.cols}x${size.rows}`
    } catch (e) {
      console.error('[zeus] Failed to attach terminal:', e)
    }
  }

  async function runClaude(wsPath?: string) {
    if (!claudeStore.installed) {
      uiStore.showToast('Claude Code not installed. Run: npm install -g @anthropic-ai/claude-code', 'error')
      return
    }
    const cwd = wsPath ?? workspaceStore.active?.path
    if (!cwd) {
      const ws = await workspaceStore.add()
      if (!ws) return
      claudeSessionStore.create(ws.path)
      return
    }
    // Reuse an existing empty conversation for this workspace instead of creating a new one
    const empty = claudeSessionStore.conversations.find(
      (c) => c.workspacePath === cwd && c.messages.length === 0 && !c.isStreaming
    )
    if (empty) {
      claudeSessionStore.switchTo(empty.id)
      return
    }
    claudeSessionStore.create(cwd)
  }

  /** Open or switch to an existing conversation (used for initial workspace load) */
  function launchClaudeConversation(cwd: string) {
    const existing = claudeSessionStore.conversations.find((c) => c.workspacePath === cwd)
    if (existing) {
      claudeSessionStore.switchTo(existing.id)
      return
    }
    claudeSessionStore.create(cwd)
  }

  // When workspace changes, swap all tab states to workspace-scoped snapshots
  let prevWorkspacePath: string | null = null
  let switchingWorkspace = false
  $effect(() => {
    const ws = workspaceStore.active
    if (ws && ws.path !== prevWorkspacePath && !switchingWorkspace) {
      switchingWorkspace = true
      prevWorkspacePath = ws.path

      // Switch all stores to this workspace's tab state
      const hadConversations = claudeSessionStore.switchWorkspace(ws.path)
      terminalStore.switchWorkspace(ws.path)
      markdownStore.switchWorkspace(ws.path)

      // Load saved sessions for this workspace
      claudeSessionStore.loadSaved(ws.path)

      // Auto-open Claude conversation if none exist for this workspace
      if (claudeStore.installed && !hadConversations) {
        launchClaudeConversation(ws.path)
      } else if (hadConversations) {
        // Ensure we're viewing the Claude tab if conversations were restored
        uiStore.activeView = 'claude'
      }

      switchingWorkspace = false
    }
  })

  async function openIDE() {
    if (!workspaceStore.active) {
      uiStore.showToast('Please select a workspace first', 'error')
      return
    }
    // Use default IDE preference or first available
    const pref = await window.zeus.ide.getPreference()
    const list = ideStore.list
    const ide = list.find((i) => i.id === pref) ?? list[0]
    if (!ide) {
      uiStore.showToast('No IDEs found on your system', 'error')
      return
    }
    const result = await ideStore.open(ide.cmd, workspaceStore.active.path)
    if (result.success) {
      uiStore.showToast(`Opening in ${ide.name}...`, 'info')
    } else {
      uiStore.showToast(`Failed: ${result.error}`, 'error')
    }
  }

  function revealInFinder() {
    if (workspaceStore.active) {
      window.zeus.system.revealInFinder(workspaceStore.active.path)
    } else {
      uiStore.showToast('No workspace selected', 'error')
    }
  }

  function toggleRightPanel() {
    uiStore.toggleRightPanel()
    terminalStore.fitActiveDebounced(250)
  }

  function handleContextAction(action: string, wsPath: string) {
    const ws = workspaceStore.list.find((w) => w.path === wsPath)
    switch (action) {
      case 'open-terminal':
        if (ws) { workspaceStore.select(ws, true); newTerminal(ws.path) }
        break
      case 'run-claude':
        if (ws) { workspaceStore.select(ws, true); runClaude(ws.path) }
        break
      case 'open-ide':
        if (ws) { workspaceStore.select(ws, true); openIDE() }
        break
      case 'reveal-finder':
        window.zeus.system.revealInFinder(wsPath)
        break
      case 'rename':
        if (ws) {
          const newName = prompt('Rename workspace:', ws.name)
          if (newName !== null && newName.trim()) {
            workspaceStore.rename(wsPath, newName.trim())
          }
        }
        break
      case 'remove':
        // Clean up all workspace-scoped resources before removing
        claudeSessionStore.removeWorkspace(wsPath)
        terminalStore.removeWorkspace(wsPath)
        markdownStore.removeWorkspace(wsPath)
        workspaceStore.remove(wsPath)
        break
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    const meta = e.metaKey || e.ctrlKey
    if (meta && e.key === 'b') {
      e.preventDefault(); uiStore.toggleSidebar(); terminalStore.fitActiveDebounced(250)
    }
    if (meta && e.key === 't') {
      e.preventDefault(); newTerminal()
    }
    if (meta && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
      e.preventDefault(); runClaude()
    }
    if (meta && e.key === 'i') {
      e.preventDefault(); toggleRightPanel()
    }
    if (meta && e.key === 'k') {
      e.preventDefault(); terminalStore.clearActive()
    }
    if (meta && e.key === 'w') {
      e.preventDefault()
      if (uiStore.activeView === 'terminal' && terminalStore.activeId !== null) {
        terminalStore.close(terminalStore.activeId)
      } else if (uiStore.activeView === 'claude' && claudeSessionStore.activeId) {
        claudeSessionStore.close(claudeSessionStore.activeId)
      } else if (uiStore.activeView === 'doc' && markdownStore.activeDocId) {
        markdownStore.close(markdownStore.activeDocId)
      }
    }
    if (e.key === 'Escape') {
      uiStore.updateModalOpen = false
      uiStore.settingsOpen = false
      uiStore.closeContextMenu()
    }
  }

</script>

<svelte:window onkeydown={handleKeydown} />

<div class="titlebar">
  <span class="titlebar-text">Zeus</span>
</div>

<div class="app">
  <Sidebar
    onupdate={() => (uiStore.updateModalOpen = true)}
    onrunClaude={() => runClaude()}
    onnewTerminal={() => newTerminal()}
  />

  <main class="main-content">
    <Toolbar
      onreveal={revealInFinder}
      ontogglePanel={toggleRightPanel}
    />

    <div class="terminal-region">
      {#if !hasContent}
        <WelcomeScreen
          onaddWorkspace={() => workspaceStore.add()}
          onrunClaude={() => runClaude()}
        />
      {/if}
      <TerminalArea />
      <ConversationView />
      {#if uiStore.activeView === 'doc'}
        <DocViewer />
      {/if}
    </div>

    <StatusBar />
  </main>

  <RightPanel />
</div>

<UpdateModal />
<ContextMenu onaction={handleContextAction} />
<SettingsPanel />
<Toast />

<style>
  :global(*), :global(*::before), :global(*::after) {
    margin: 0; padding: 0; box-sizing: border-box;
  }
  :global(html), :global(body) {
    height: 100%;
    overflow: hidden;
    background: var(--bg-base);
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: 13px;
    -webkit-font-smoothing: antialiased;
    user-select: none;
  }
  :global(::-webkit-scrollbar) { width: 6px; height: 6px; }
  :global(::-webkit-scrollbar-track) { background: transparent; }
  :global(::-webkit-scrollbar-thumb) { background: var(--border-strong); border-radius: 3px; }
  :global(::-webkit-scrollbar-thumb:hover) { background: var(--text-muted); }

  .titlebar {
    height: 52px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-surface);
    border-bottom: 1px solid var(--border-subtle);
    -webkit-app-region: drag;
  }
  .titlebar-text {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-secondary);
    pointer-events: none;
  }

  .app {
    display: flex;
    height: calc(100vh - 52px);
  }

  .main-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    background: var(--bg-base);
  }

  .terminal-region {
    flex: 1;
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
</style>
