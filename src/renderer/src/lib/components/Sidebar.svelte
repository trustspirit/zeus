<script lang="ts">
  import { workspaceStore } from '../stores/workspace.svelte.js'
  import { claudeStore } from '../stores/claude.svelte.js'
  import { uiStore } from '../stores/ui.svelte.js'
  import WorkspaceItem from './WorkspaceItem.svelte'
  import IconPlus from './icons/IconPlus.svelte'
  import IconRefresh from './icons/IconRefresh.svelte'
  import IconBolt from './icons/IconBolt.svelte'
  import IconFolder from './icons/IconFolder.svelte'

  let { onupdate }: { onupdate: () => void } = $props()

  // ── Drag-and-drop reorder ──
  let dragIdx = $state<number | null>(null)
  let dragOverIdx = $state<number | null>(null)

  function handleDragStart(e: DragEvent, idx: number) {
    dragIdx = idx
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', String(idx))
    }
  }

  function handleDragOver(e: DragEvent, idx: number) {
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    dragOverIdx = idx
  }

  function handleDragEnd() {
    if (dragIdx !== null && dragOverIdx !== null && dragIdx !== dragOverIdx) {
      workspaceStore.reorder(dragIdx, dragOverIdx)
    }
    dragIdx = null
    dragOverIdx = null
  }
</script>

<aside class="sidebar" class:collapsed={uiStore.sidebarCollapsed}>
  <!-- Logo -->
  <div class="sidebar-header">
    <div class="sidebar-logo">
      <IconBolt size={24} />
      <span>Zeus</span>
    </div>
  </div>

  <!-- Workspace list -->
  <div class="sidebar-section">
    <div class="sidebar-section-header">
      <span>Workspaces</span>
      <button class="icon-btn" title="Add workspace" onclick={() => workspaceStore.add()}>
        <IconPlus size={16} />
      </button>
    </div>
    <div class="workspace-list">
      {#if workspaceStore.list.length === 0}
        <div class="empty-state">
          <IconFolder size={32} />
          <p>No workspaces yet.<br />Add a repository to get started.</p>
        </div>
      {:else}
        {#each workspaceStore.list as ws, idx (ws.path)}
          <WorkspaceItem
            workspace={ws}
            index={idx}
            isActive={workspaceStore.active?.path === ws.path}
            onselect={() => { workspaceStore.select(ws).then(show => { if (show) uiStore.showToast(`Switched to ${ws.name}`, 'info') }) }}
            oncontextmenu={(e) => { e.preventDefault(); uiStore.openContextMenu(e.clientX, e.clientY, ws.path) }}
            ondblclick={() => { workspaceStore.select(ws, true); }}
            ondragstart={(e) => handleDragStart(e, idx)}
            ondragover={(e) => handleDragOver(e, idx)}
            ondragend={handleDragEnd}
            dragOverIndex={dragOverIdx}
          />
        {/each}
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
      <button class="icon-btn small" title="Update Claude Code" onclick={onupdate}>
        <IconRefresh size={14} />
      </button>
    </div>
  </div>
</aside>

<style>
  .sidebar {
    width: 260px;
    min-width: 260px;
    background: #141414;
    border-right: 1px solid #262626;
    display: flex;
    flex-direction: column;
    transition: width 200ms ease, min-width 200ms ease, opacity 200ms ease;
    overflow: hidden;
  }
  .sidebar.collapsed { width: 0; min-width: 0; opacity: 0; border-right: none; }

  .sidebar-header { padding: 16px 16px 12px; border-bottom: 1px solid #262626; }
  .sidebar-logo {
    display: flex;
    align-items: center;
    gap: 10px;
    color: #c084fc;
    font-weight: 600;
    font-size: 15px;
    letter-spacing: -0.01em;
  }

  .sidebar-section { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .sidebar-section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px 8px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #666;
  }

  .workspace-list { flex: 1; overflow-y: auto; padding: 0 8px 8px; }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 32px 16px;
    color: #666;
    text-align: center;
    gap: 8px;
  }
  .empty-state p { font-size: 12px; line-height: 1.4; }

  .sidebar-footer { padding: 12px 16px; border-top: 1px solid #262626; }
  .claude-status { display: flex; align-items: center; gap: 10px; }

  .status-dot {
    width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
    transition: background 200ms ease;
    background: #666;
  }
  .status-dot.installed { background: #4ade80; box-shadow: 0 0 6px rgba(74, 222, 128, 0.4); }
  .status-dot.not-installed { background: #f87171; box-shadow: 0 0 6px rgba(248, 113, 113, 0.4); }
  .status-dot.updating { background: #fbbf24; animation: pulse 1.5s infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

  .claude-info { flex: 1; min-width: 0; }
  .claude-label { display: block; font-size: 12px; font-weight: 500; color: #e6e6e6; }
  .claude-version {
    display: block; font-size: 10px; color: #666;
    font-family: 'D2Coding', 'JetBrains Mono', 'SF Mono', monospace;
  }

  .icon-btn {
    display: flex; align-items: center; justify-content: center;
    width: 30px; height: 30px; border: none; background: transparent;
    color: #999; border-radius: 6px; cursor: pointer; transition: all 120ms ease;
  }
  .icon-btn:hover { background: #222; color: #e6e6e6; }
  .icon-btn.small { width: 24px; height: 24px; }
</style>
