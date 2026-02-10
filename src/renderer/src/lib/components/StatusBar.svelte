<script lang="ts">
  import { workspaceStore } from '../stores/workspace.svelte.js'
  import { claudeStore } from '../stores/claude.svelte.js'
  import { uiStore } from '../stores/ui.svelte.js'
  import IconClaude from './icons/IconClaude.svelte'

  const shortVersion = $derived.by(() => {
    if (!claudeStore.version) return null
    const m = claudeStore.version.match(/(\d+\.\d+\.\d+)/)
    return m ? m[1] : claudeStore.version
  })
</script>

<div class="statusbar">
  <div class="left">
    <span class="item">{workspaceStore.active?.name ?? 'No workspace'}</span>
    {#if workspaceStore.activeDirInfo?.hasGit}
      <span class="item git-item">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><path d="M6 9v12"/></svg>
        git
      </span>
    {/if}
  </div>
  <div class="right">
    {#if claudeStore.installed && shortVersion}
      <button class="item claude-ver" title="Click to check for updates" onclick={() => (uiStore.updateModalOpen = true)}>
        <IconClaude size={11} />
        <span>v{shortVersion}</span>
      </button>
    {/if}
    {#if uiStore.termSize}
      <span class="item">{uiStore.termSize}</span>
    {/if}
  </div>
</div>

<style>
  .statusbar {
    height: 28px; display: flex; align-items: center; justify-content: space-between;
    padding: 0 12px; background: #21252b; border-top: 1px solid #181a1f;
    font-size: 11px; color: #5c6370;
    font-family: 'D2Coding', 'JetBrains Mono', 'SF Mono', monospace;
  }
  .left, .right { display: flex; align-items: center; gap: 16px; }
  .item { display: flex; align-items: center; gap: 4px; }
  .git-item { color: #61afef; }

  .claude-ver {
    border: none; background: none; cursor: pointer;
    font-family: inherit; font-size: 11px;
    color: #5c6370; padding: 2px 6px; border-radius: 4px;
    display: flex; align-items: center; gap: 4px;
    transition: all 120ms ease;
  }
  .claude-ver:hover { background: #2c313a; color: #c678dd; }
</style>
