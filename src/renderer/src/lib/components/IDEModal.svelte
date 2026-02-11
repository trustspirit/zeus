<script lang="ts">
  import { ideStore } from '../stores/ide.svelte.js'
  import { workspaceStore } from '../stores/workspace.svelte.js'
  import { uiStore } from '../stores/ui.svelte.js'
  import IconCode from './icons/IconCode.svelte'

  async function openIDE(cmd: string) {
    if (!workspaceStore.active) return
    const result = await ideStore.open(cmd, workspaceStore.active.path)
    if (result.success) {
      uiStore.showToast(`Opening in ${cmd}...`, 'info')
    } else {
      uiStore.showToast(`Failed: ${result.error}`, 'error')
    }
    uiStore.ideModalOpen = false
  }
</script>

{#if uiStore.ideModalOpen}
  <div class="modal">
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="backdrop" onclick={() => (uiStore.ideModalOpen = false)}></div>
    <div class="content">
      <div class="header">
        <h2>Open in IDE</h2>
        <button class="close" onclick={() => (uiStore.ideModalOpen = false)}>&times;</button>
      </div>
      <div class="body">
        {#if ideStore.list.length === 0}
          <p class="empty">No supported IDEs found on your system.</p>
        {:else}
          {#each ideStore.list as ide (ide.id)}
            <button class="ide-item" onclick={() => openIDE(ide.cmd)}>
              <div class="ide-icon"><IconCode size={18} /></div>
              <span class="ide-name">{ide.name}</span>
              <span class="ide-cmd">{ide.cmd}</span>
            </button>
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .modal {
    position: fixed; inset: 0; z-index: 100;
    display: flex; align-items: center; justify-content: center;
  }
  .backdrop {
    position: absolute; inset: 0;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
  }
  .content {
    position: relative; background: var(--bg-surface); border: 1px solid var(--border);
    border-radius: 12px; width: 420px; max-height: 80vh;
    overflow: hidden; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
  }
  .header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 20px; border-bottom: 1px solid var(--border);
  }
  h2 { font-size: 15px; font-weight: 600; color: var(--text-primary); }
  .close {
    display: flex; align-items: center; justify-content: center;
    width: 28px; height: 28px; border: none; background: transparent;
    color: var(--text-muted); border-radius: 6px; cursor: pointer; font-size: 20px;
  }
  .close:hover { background: var(--border); color: var(--text-primary); }
  .body { padding: 16px 20px; overflow-y: auto; }
  .empty { color: var(--text-secondary); font-size: 13px; text-align: center; padding: 20px; }

  .ide-item {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 12px; border-radius: 6px; cursor: pointer;
    border: none; background: transparent; color: var(--text-primary);
    font-size: 14px; font-weight: 500; width: 100%; text-align: left;
    font-family: inherit; transition: background 120ms ease;
  }
  .ide-item:hover { background: var(--border); }
  .ide-icon {
    width: 32px; height: 32px; border-radius: 6px; background: var(--bg-raised);
    display: flex; align-items: center; justify-content: center; color: var(--text-secondary);
  }
  .ide-name { flex: 1; }
  .ide-cmd { font-size: 11px; color: var(--text-muted); font-family: 'D2Coding', 'JetBrains Mono', 'SF Mono', monospace; }
</style>
