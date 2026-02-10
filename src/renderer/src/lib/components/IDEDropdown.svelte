<script lang="ts">
  import { ideStore } from '../stores/ide.svelte.js'
  import { workspaceStore } from '../stores/workspace.svelte.js'
  import { uiStore } from '../stores/ui.svelte.js'

  let isOpen = $state(false)

  /** IDE icon map — returns SVG path content for each known IDE */
  function ideIcon(iconId: string): { path: string; viewBox: string; color: string } {
    switch (iconId) {
      case 'vscode':
        return {
          path: 'M17.58 2.58L12.7 7.47 6.93 3.07 2 5.13v13.74l4.93 2.06 5.77-4.4 4.88 4.89L22 18.87V5.13l-4.42-2.55zM6 15.6V8.4l3.5 3.6L6 15.6zm11 1.27l-4-3.87 4-3.87v7.74z',
          viewBox: '0 0 24 24',
          color: '#007ACC'
        }
      case 'cursor':
        return {
          path: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
          viewBox: '0 0 24 24',
          color: '#00D4FF'
        }
      case 'antigravity':
        return {
          path: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 4l6 6h-4v4h-4v-4H6l6-6z',
          viewBox: '0 0 24 24',
          color: '#FF6B6B'
        }
      case 'windsurf':
        return {
          path: 'M2 20L12 4l10 16H2zm10-4a2 2 0 100-4 2 2 0 000 4z',
          viewBox: '0 0 24 24',
          color: '#00BFA5'
        }
      case 'zed':
        return {
          path: 'M3 3h18L3 21h18',
          viewBox: '0 0 24 24',
          color: '#F9CB00'
        }
      case 'idea':
        return {
          path: 'M12 2a7 7 0 00-4 12.74V17h8v-2.26A7 7 0 0012 2zM9 21v-1h6v1a1 1 0 01-1 1h-4a1 1 0 01-1-1z',
          viewBox: '0 0 24 24',
          color: '#FE315D'
        }
      case 'webstorm':
        return {
          path: 'M12 2a7 7 0 00-4 12.74V17h8v-2.26A7 7 0 0012 2zM9 21v-1h6v1a1 1 0 01-1 1h-4a1 1 0 01-1-1z',
          viewBox: '0 0 24 24',
          color: '#00CDD7'
        }
      case 'sublime':
        return {
          path: 'M2 8l10-4 10 4M2 16l10 4 10-4M2 12l10-4 10 4',
          viewBox: '0 0 24 24',
          color: '#FF9800'
        }
      case 'vim':
        return {
          path: 'M2 4l5 8-5 8h4l5-8-5-8H2zm10 0l5 8-5 8h4l5-8-5-8h-4z',
          viewBox: '0 0 24 24',
          color: '#019833'
        }
      default:
        return {
          path: 'M16 18l6-6-6-6M8 6l-6 6 6 6',
          viewBox: '0 0 24 24',
          color: '#7f848e'
        }
    }
  }

  export function toggle() {
    isOpen = !isOpen
  }

  export function open() {
    isOpen = true
  }

  export function close() {
    isOpen = false
  }

  async function openIDE(cmd: string) {
    if (!workspaceStore.active) return
    const result = await ideStore.open(cmd, workspaceStore.active.path)
    if (result.success) {
      uiStore.showToast(`Opening in ${cmd}...`, 'info')
    } else {
      uiStore.showToast(`Failed: ${result.error}`, 'error')
    }
    isOpen = false
  }

  function handleWindowClick(e: MouseEvent) {
    const target = e.target as HTMLElement
    if (isOpen && !target.closest('.ide-dropdown')) {
      isOpen = false
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<svelte:window onclick={handleWindowClick} />

<div class="ide-dropdown">
  <button class="ide-trigger" class:active={isOpen} onclick={toggle} title="Open in IDE">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
    <svg class="caret" class:open={isOpen} width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="6 9 12 15 18 9"/></svg>
  </button>

  {#if isOpen}
    <div class="ide-menu">
      <div class="ide-menu-header">Open in IDE</div>
      {#if ideStore.list.length === 0}
        <div class="ide-empty">No IDEs detected</div>
      {:else}
        {#each ideStore.list as ide (ide.id)}
          {@const icon = ideIcon(ide.icon)}
          <button class="ide-option" onclick={() => openIDE(ide.cmd)}>
            <div class="ide-icon-wrap" style="background: {icon.color}1a;">
              <svg width="16" height="16" viewBox={icon.viewBox} fill="none" stroke={icon.color} stroke-width="1.5">
                <path d={icon.path}/>
              </svg>
            </div>
            <div class="ide-info">
              <span class="ide-name">{ide.name}</span>
              <span class="ide-cmd">{ide.cmd}</span>
            </div>
          </button>
        {/each}
      {/if}
    </div>
  {/if}
</div>

<style>
  .ide-dropdown {
    position: relative;
  }

  .ide-trigger {
    display: flex;
    align-items: center;
    gap: 3px;
    width: auto;
    height: 30px;
    padding: 0 8px;
    border: none;
    background: transparent;
    color: #7f848e;
    border-radius: 6px;
    cursor: pointer;
    transition: all 120ms ease;
  }
  .ide-trigger:hover, .ide-trigger.active {
    background: #3e4451;
    color: #abb2bf;
  }
  .caret {
    transition: transform 150ms ease;
    opacity: 0.5;
  }
  .caret.open { transform: rotate(180deg); opacity: 1; }

  .ide-menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    min-width: 220px;
    background: #2c313a;
    border: 1px solid #4b5263;
    border-radius: 10px;
    padding: 4px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    z-index: 200;
    animation: ide-menu-in 120ms ease;
  }
  @keyframes ide-menu-in {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .ide-menu-header {
    padding: 6px 10px 4px;
    font-size: 10px;
    font-weight: 600;
    color: #4b5263;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .ide-empty {
    padding: 12px;
    text-align: center;
    color: #5c6370;
    font-size: 12px;
  }

  .ide-option {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 7px 10px;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: #abb2bf;
    cursor: pointer;
    text-align: left;
    font-family: inherit;
    transition: background 80ms ease;
  }
  .ide-option:hover { background: #3e4451; }

  .ide-icon-wrap {
    width: 30px;
    height: 30px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .ide-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .ide-name {
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
  }
  .ide-cmd {
    font-size: 10px;
    color: #5c6370;
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
  }
</style>
