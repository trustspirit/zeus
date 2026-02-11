<script lang="ts">
  import { workspaceStore } from '../stores/workspace.svelte.js'
  import { claudeSessionStore } from '../stores/claude-session.svelte.js'
  import { terminalStore } from '../stores/terminal.svelte.js'
  import { claudeStore } from '../stores/claude.svelte.js'
  import { uiStore } from '../stores/ui.svelte.js'
  import { markdownStore } from '../stores/markdown.svelte.js'
  import IconPlus from './icons/IconPlus.svelte'
  import IconRefresh from './icons/IconRefresh.svelte'
  import IconBolt from './icons/IconBolt.svelte'
  import IconClaude from './icons/IconClaude.svelte'
  import IconTerminal from './icons/IconTerminal.svelte'

  let { onupdate, onrunClaude, onnewTerminal }: {
    onupdate: () => void
    onrunClaude: () => void
    onnewTerminal: () => void
  } = $props()

  // ── Workspace dropdown ──
  let dropdownOpen = $state(false)
  let renamingWsPath = $state<string | null>(null)
  let renameValue = $state('')
  let renameInputEl = $state<HTMLInputElement | null>(null)

  function selectWorkspace(ws: typeof workspaceStore.list[0]) {
    if (renamingWsPath) return // don't close while renaming
    dropdownOpen = false
    workspaceStore.select(ws)
  }

  function handleAddWorkspace() {
    dropdownOpen = false
    workspaceStore.add()
  }

  function startRename(ws: typeof workspaceStore.list[0], e?: MouseEvent) {
    e?.stopPropagation()
    renamingWsPath = ws.path
    renameValue = ws.name
    requestAnimationFrame(() => {
      renameInputEl?.focus()
      renameInputEl?.select()
    })
  }

  async function confirmRename() {
    if (renamingWsPath && renameValue.trim()) {
      await workspaceStore.rename(renamingWsPath, renameValue.trim())
    }
    renamingWsPath = null
    renameValue = ''
  }

  function cancelRename() {
    renamingWsPath = null
    renameValue = ''
  }

  function handleRenameKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); confirmRename() }
    else if (e.key === 'Escape') { e.preventDefault(); cancelRename() }
  }

  async function removeWorkspace(wsPath: string, e?: MouseEvent) {
    e?.stopPropagation()
    claudeSessionStore.removeWorkspace(wsPath)
    terminalStore.removeWorkspace(wsPath)
    markdownStore.removeWorkspace(wsPath)
    workspaceStore.remove(wsPath)
    if (workspaceStore.list.length === 0) {
      dropdownOpen = false
    }
  }

  // Close dropdown on outside click
  function handleWindowClick(e: MouseEvent) {
    const target = e.target as HTMLElement
    if (!target.closest('.ws-dropdown')) {
      dropdownOpen = false
      if (renamingWsPath) cancelRename()
    }
  }

  // ── Context menu for workspace ──
  function handleWsContext(e: MouseEvent, wsPath: string) {
    e.preventDefault()
    dropdownOpen = false
    uiStore.openContextMenu(e.clientX, e.clientY, wsPath)
  }

  const shortPath = $derived(
    workspaceStore.active
      ? workspaceStore.active.path.replace(/^\/Users\/[^/]+/, '~')
      : ''
  )
</script>

<svelte:window onclick={handleWindowClick} />

<aside class="sidebar" class:collapsed={uiStore.sidebarCollapsed}>
  <!-- Logo -->
  <div class="sidebar-header">
    <div class="sidebar-logo">
      <IconBolt size={22} />
      <span>Zeus</span>
    </div>
  </div>

  <!-- Workspace dropdown -->
  <div class="ws-section">
    <div class="ws-dropdown">
      <button class="ws-trigger" onclick={() => (dropdownOpen = !dropdownOpen)}>
        {#if workspaceStore.active}
          <div class="ws-trigger-icon">{workspaceStore.active.name.charAt(0)}</div>
          <div class="ws-trigger-info">
            <span class="ws-trigger-name">{workspaceStore.active.name}</span>
            <span class="ws-trigger-path">{shortPath}</span>
          </div>
        {:else}
          <div class="ws-trigger-icon empty">?</div>
          <div class="ws-trigger-info">
            <span class="ws-trigger-name placeholder">Select workspace</span>
          </div>
        {/if}
        <svg class="ws-chevron" class:open={dropdownOpen} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
      </button>

      {#if dropdownOpen}
        <div class="ws-menu">
          {#each workspaceStore.list as ws (ws.path)}
            {#if renamingWsPath === ws.path}
              <!-- Rename input -->
              <div class="ws-menu-item rename-row">
                <div class="ws-menu-icon" class:active={workspaceStore.active?.path === ws.path}>{renameValue.charAt(0) || '?'}</div>
                <input
                  bind:this={renameInputEl}
                  bind:value={renameValue}
                  class="ws-rename-input"
                  onkeydown={handleRenameKeydown}
                  onblur={confirmRename}
                  spellcheck="false"
                />
              </div>
            {:else}
              <div
                class="ws-menu-item"
                class:active={workspaceStore.active?.path === ws.path}
                role="button"
                tabindex="0"
                onclick={() => selectWorkspace(ws)}
                onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectWorkspace(ws) } }}
                oncontextmenu={(e) => handleWsContext(e, ws.path)}
              >
                <div class="ws-menu-icon" class:active={workspaceStore.active?.path === ws.path}>{ws.name.charAt(0)}</div>
                <div class="ws-menu-info">
                  <span class="ws-menu-name">{ws.name}</span>
                  <span class="ws-menu-path">{ws.path.replace(/^\/Users\/[^/]+/, '~')}</span>
                </div>
                <div class="ws-item-actions">
                  {#if workspaceStore.active?.path === ws.path}
                    <svg class="ws-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  {/if}
                  <button class="ws-action-btn" title="Rename" onclick={(e) => startRename(ws, e)}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                  </button>
                  <button class="ws-action-btn ws-delete-btn" title="Remove workspace" onclick={(e) => removeWorkspace(ws.path, e)}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
              </div>
            {/if}
          {/each}
          <div class="ws-menu-divider"></div>
          <button class="ws-menu-item add-item" onclick={handleAddWorkspace}>
            <IconPlus size={14} />
            <span>Add Workspace</span>
          </button>
        </div>
      {/if}
    </div>
  </div>

  <!-- Session list -->
  <div class="sessions-section">
    <!-- Section header with new buttons -->
    <div class="sessions-header">
      <span class="sessions-label">Sessions</span>
      <div class="sessions-actions">
        <button class="ses-btn claude-accent" title="New Claude Code" onclick={onrunClaude}>
          <IconClaude size={13} />
        </button>
        <button class="ses-btn" title="New Terminal" onclick={onnewTerminal}>
          <IconTerminal size={13} />
        </button>
      </div>
    </div>

    <div class="sessions-list">
      <!-- Active Claude conversations -->
      {#each claudeSessionStore.conversations as conv (conv.id)}
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
        <div
          class="session-item"
          class:active={uiStore.activeView === 'claude' && conv.id === claudeSessionStore.activeId}
          onclick={() => claudeSessionStore.switchTo(conv.id)}
        >
          <span class="session-icon claude"><IconClaude size={14} /></span>
          <span class="session-name">{conv.title}</span>
          {#if conv.isStreaming}
            <span class="streaming-dot"></span>
          {/if}
          <button class="session-close" onclick={(e) => { e.stopPropagation(); claudeSessionStore.close(conv.id) }}>&times;</button>
        </div>
      {/each}

      <!-- Active terminal sessions -->
      {#each terminalStore.sessions as session (session.id)}
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
        <div
          class="session-item"
          class:active={uiStore.activeView === 'terminal' && session.id === terminalStore.activeId}
          onclick={() => { terminalStore.switchTo(session.id); uiStore.activeView = 'terminal'; requestAnimationFrame(() => terminalStore.focusActive()) }}
        >
          <span class="session-icon terminal"><IconTerminal size={14} /></span>
          <span class="session-name">{session.title}</span>
          <button class="session-close" onclick={(e) => { e.stopPropagation(); terminalStore.close(session.id) }}>&times;</button>
        </div>
      {/each}

      <!-- Saved sessions (click to resume) -->
      {#each claudeSessionStore.savedSessions as saved (saved.sessionId)}
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
        <div
          class="session-item saved"
          onclick={() => claudeSessionStore.resume(saved)}
        >
          <span class="session-icon claude muted"><IconClaude size={14} /></span>
          <span class="session-name">{saved.title}</span>
          <span class="session-time">
            {new Date(saved.lastUsed).toLocaleDateString([], { month: 'short', day: 'numeric' })}
          </span>
          <button class="session-close" onclick={(e) => { e.stopPropagation(); claudeSessionStore.deleteSaved(saved.sessionId) }}>&times;</button>
        </div>
      {/each}

      <!-- Empty state -->
      {#if claudeSessionStore.conversations.length === 0 && terminalStore.sessions.length === 0 && claudeSessionStore.savedSessions.length === 0}
        <div class="sessions-empty">
          <p>No sessions</p>
        </div>
      {/if}
    </div>
  </div>

  <!-- Claude Code status -->
  <div class="sidebar-footer">
    <div class="claude-status">
      <div class="status-dot {claudeStore.status}"></div>
      <div class="claude-info">
        <span class="claude-label">Claude Code</span>
        <span class="claude-version">{claudeStore.version ?? (claudeStore.installed ? 'installed' : 'not installed')}</span>
      </div>
      <button class="icon-btn small" title="Settings" onclick={() => uiStore.toggleSettings()}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </button>
      <button class="icon-btn small" title="Update Claude Code" onclick={onupdate}>
        <IconRefresh size={14} />
      </button>
    </div>
  </div>
</aside>

<style>
  .sidebar {
    width: 260px; min-width: 260px;
    background: var(--bg-surface);
    border-right: 1px solid var(--border-subtle);
    display: flex; flex-direction: column;
    transition: width 200ms ease, min-width 200ms ease, opacity 200ms ease;
    overflow: hidden;
  }
  .sidebar.collapsed { width: 0; min-width: 0; opacity: 0; border-right: none; }

  .sidebar-header { padding: 14px 16px 12px; border-bottom: 1px solid var(--border-subtle); }
  .sidebar-logo {
    display: flex; align-items: center; gap: 10px;
    color: var(--accent); font-weight: 600; font-size: 15px; letter-spacing: -0.01em;
  }

  /* ── Workspace dropdown ── */
  .ws-section { padding: 10px 10px 0; flex-shrink: 0; }
  .ws-dropdown { position: relative; }

  .ws-trigger {
    display: flex; align-items: center; gap: 8px; width: 100%;
    padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px;
    background: var(--bg-base); cursor: pointer;
    font-family: inherit; text-align: left; transition: all 120ms ease;
  }
  .ws-trigger:hover { border-color: var(--border-strong); background: var(--bg-raised); }

  .ws-trigger-icon {
    width: 28px; height: 28px; border-radius: 6px;
    background: var(--border); display: flex; align-items: center; justify-content: center;
    flex-shrink: 0; color: var(--accent); font-size: 13px; font-weight: 600;
    font-family: var(--font-mono); text-transform: uppercase;
  }
  .ws-trigger-icon.empty { color: var(--text-muted); }

  .ws-trigger-info { flex: 1; min-width: 0; }
  .ws-trigger-name {
    display: block; font-size: 12px; font-weight: 500; color: var(--text-primary);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .ws-trigger-name.placeholder { color: var(--text-muted); }
  .ws-trigger-path {
    display: block; font-size: 10px; color: var(--text-muted); margin-top: 1px;
    font-family: var(--font-mono);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }

  .ws-chevron { flex-shrink: 0; color: var(--text-muted); transition: transform 150ms ease; }
  .ws-chevron.open { transform: rotate(180deg); }

  .ws-menu {
    position: absolute; top: calc(100% + 4px); left: 0; right: 0;
    background: var(--bg-raised); border: 1px solid var(--border); border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    z-index: 50; max-height: 320px; overflow-y: auto; padding: 4px;
  }

  .ws-menu-item {
    display: flex; align-items: center; gap: 8px; width: 100%;
    padding: 7px 8px; border: none; background: transparent;
    border-radius: 5px; cursor: pointer; font-family: inherit;
    text-align: left; transition: background 100ms ease;
  }
  .ws-menu-item:hover { background: var(--border); }
  .ws-menu-item.active { background: var(--accent-glow); }

  .ws-menu-icon {
    width: 24px; height: 24px; border-radius: 5px;
    background: var(--border); display: flex; align-items: center; justify-content: center;
    flex-shrink: 0; color: var(--text-secondary); font-size: 11px; font-weight: 600;
    font-family: var(--font-mono); text-transform: uppercase;
  }
  .ws-menu-icon.active { background: var(--accent-bg-hover); color: var(--accent); }

  .ws-menu-info { flex: 1; min-width: 0; }
  .ws-menu-name {
    display: block; font-size: 12px; font-weight: 500; color: var(--text-primary);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .ws-menu-path {
    display: block; font-size: 10px; color: var(--text-muted); margin-top: 1px;
    font-family: var(--font-mono);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }

  /* ── Workspace item actions (rename/delete) ── */
  .ws-item-actions {
    display: flex; align-items: center; gap: 2px;
    opacity: 0; transition: opacity 100ms ease; flex-shrink: 0;
  }
  .ws-menu-item:hover .ws-item-actions { opacity: 1; }
  .ws-check { flex-shrink: 0; }
  .ws-action-btn {
    display: flex; align-items: center; justify-content: center;
    width: 22px; height: 22px; border: none; border-radius: 4px;
    background: transparent; color: var(--text-muted); cursor: pointer;
    padding: 0; transition: all 100ms ease;
  }
  .ws-action-btn:hover { background: var(--border); color: var(--text-primary); }
  .ws-delete-btn:hover { background: var(--red-bg); color: var(--red); }

  /* ── Rename input ── */
  .ws-menu-item.rename-row { cursor: default; }
  .ws-menu-item.rename-row:hover { background: transparent; }
  .ws-rename-input {
    flex: 1; min-width: 0; padding: 4px 8px;
    background: var(--bg-deep); border: 1px solid var(--accent); border-radius: 4px;
    color: var(--text-primary); font-size: 12px; font-weight: 500;
    font-family: inherit; outline: none;
  }

  .ws-menu-divider { height: 1px; background: var(--border); margin: 4px 8px; }

  .ws-menu-item.add-item { gap: 6px; color: var(--text-secondary); font-size: 12px; padding: 8px 10px; }
  .ws-menu-item.add-item:hover { color: var(--text-primary); }

  /* ── Sessions ── */
  .sessions-section { flex: 1; display: flex; flex-direction: column; overflow: hidden; margin-top: 4px; }

  .sessions-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 14px 6px;
  }
  .sessions-label {
    font-size: 10px; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.05em; color: var(--text-muted);
  }
  .sessions-actions { display: flex; gap: 2px; }

  .ses-btn {
    display: flex; align-items: center; justify-content: center;
    width: 24px; height: 24px; border: none; background: transparent;
    color: var(--text-muted); border-radius: 5px; cursor: pointer; transition: all 120ms ease;
  }
  .ses-btn:hover { background: var(--border); color: var(--text-primary); }
  .ses-btn.claude-accent { color: var(--accent); }
  .ses-btn.claude-accent:hover { background: var(--accent-bg); color: var(--accent-hover); }

  .sessions-list { flex: 1; overflow-y: auto; padding: 0 8px 8px; }

  .session-item {
    display: flex; align-items: center; gap: 8px; width: 100%;
    padding: 6px 8px; border: none; background: transparent;
    border-radius: 6px; cursor: pointer; font-family: inherit;
    text-align: left; transition: all 100ms ease;
    color: var(--text-secondary); font-size: 12px;
  }
  .session-item:hover { background: var(--bg-raised); color: var(--text-primary); }
  .session-item.active { background: var(--bg-raised); color: var(--text-primary); }

  .session-icon { display: flex; align-items: center; flex-shrink: 0; }
  .session-icon.claude { color: var(--accent); }
  .session-icon.claude.muted { color: var(--text-dim); }
  .session-icon.terminal { color: var(--blue); }

  .session-name { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .streaming-dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--accent); flex-shrink: 0;
    animation: stream-pulse 1.2s ease-in-out infinite;
  }
  @keyframes stream-pulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }

  .session-time {
    font-size: 10px; color: var(--text-muted); flex-shrink: 0;
    font-family: var(--font-mono);
  }

  .session-close {
    display: none; width: 16px; height: 16px; border: none; background: transparent;
    color: var(--text-muted); border-radius: 3px; cursor: pointer;
    font-size: 14px; flex-shrink: 0; align-items: center; justify-content: center;
  }
  .session-item:hover .session-close { display: flex; }
  .session-close:hover { background: var(--border); color: var(--red); }

  .session-item.saved { opacity: 0.65; }
  .session-item.saved:hover { opacity: 1; }

  .sessions-empty { text-align: center; padding: 20px 12px; color: var(--text-muted); font-size: 11px; }

  /* ── Footer ── */
  .sidebar-footer { padding: 12px 16px; border-top: 1px solid var(--border-subtle); flex-shrink: 0; }
  .claude-status { display: flex; align-items: center; gap: 10px; }

  .status-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: var(--text-muted); }
  .status-dot.installed { background: var(--green); box-shadow: 0 0 6px rgba(152, 195, 121, 0.4); }
  .status-dot.not-installed { background: var(--red); box-shadow: 0 0 6px rgba(224, 108, 117, 0.4); }
  .status-dot.updating { background: var(--yellow); animation: pulse 1.5s infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

  .claude-info { flex: 1; min-width: 0; }
  .claude-label { display: block; font-size: 12px; font-weight: 500; color: var(--text-primary); }
  .claude-version {
    display: block; font-size: 10px; color: var(--text-muted);
    font-family: var(--font-mono);
  }

  .icon-btn {
    display: flex; align-items: center; justify-content: center;
    width: 30px; height: 30px; border: none; background: transparent;
    color: var(--text-secondary); border-radius: 6px; cursor: pointer; transition: all 120ms ease;
  }
  .icon-btn:hover { background: var(--border); color: var(--text-primary); }
  .icon-btn.small { width: 24px; height: 24px; }
</style>
