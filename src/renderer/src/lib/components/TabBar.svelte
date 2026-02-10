<script lang="ts">
  import { terminalStore } from '../stores/terminal.svelte.js'
  import { markdownStore } from '../stores/markdown.svelte.js'
  import { uiStore } from '../stores/ui.svelte.js'
  import IconBolt from './icons/IconBolt.svelte'
  import IconTerminal from './icons/IconTerminal.svelte'

  let tabBarEl: HTMLDivElement

  function switchToTerminal(id: number) {
    terminalStore.switchTo(id)
    uiStore.activeView = 'terminal'
  }

  function switchToDoc(id: string) {
    void markdownStore.switchTo(id)
  }

  function closeDoc(e: MouseEvent, id: string) {
    e.stopPropagation()
    markdownStore.close(id)
  }

  function closeTerminal(e: MouseEvent, id: number) {
    e.stopPropagation()
    terminalStore.close(id)
  }

  /** Middle-click (wheel button) on a terminal tab → close it */
  function handleTerminalAuxClick(e: MouseEvent, id: number) {
    if (e.button === 1) { e.preventDefault(); terminalStore.close(id) }
  }

  /** Middle-click on a doc tab → close it */
  function handleDocAuxClick(e: MouseEvent, id: string) {
    if (e.button === 1) { e.preventDefault(); markdownStore.close(id) }
  }

  /** Horizontal scroll with mouse wheel on the tab bar */
  function handleWheel(e: WheelEvent) {
    if (!tabBarEl) return
    // Convert vertical scroll to horizontal
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault()
      tabBarEl.scrollLeft += e.deltaY
    }
  }
</script>

<div class="tab-bar" bind:this={tabBarEl} onwheel={handleWheel}>
  <!-- Terminal tabs -->
  {#each terminalStore.sessions as session (session.id)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="tab"
      class:active={uiStore.activeView === 'terminal' && session.id === terminalStore.activeId}
      onauxclick={(e) => handleTerminalAuxClick(e, session.id)}
    >
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
      <div class="tab-body" onclick={() => switchToTerminal(session.id)}>
        <span class="tab-icon" class:claude={session.isClaude}>
          {#if session.isClaude}
            <IconBolt size={14} />
          {:else}
            <IconTerminal size={14} />
          {/if}
        </span>
        <span class="tab-title">{session.title}</span>
      </div>
      <button
        class="tab-close"
        onclick={(e) => closeTerminal(e, session.id)}
      >&times;</button>
    </div>
  {/each}

  <!-- Separator if both types exist -->
  {#if terminalStore.sessions.length > 0 && markdownStore.openTabs.length > 0}
    <div class="tab-sep"></div>
  {/if}

  <!-- Doc tabs -->
  {#each markdownStore.openTabs as tab (tab.id)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="tab doc-tab"
      class:active={uiStore.activeView === 'doc' && tab.id === markdownStore.activeDocId}
      onauxclick={(e) => handleDocAuxClick(e, tab.id)}
    >
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
      <div class="tab-body" onclick={() => switchToDoc(tab.id)}>
        <span class="tab-icon doc">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        </span>
        <span class="tab-title">{tab.file.name}</span>
      </div>
      <button
        class="tab-close"
        onclick={(e) => closeDoc(e, tab.id)}
      >&times;</button>
    </div>
  {/each}
</div>

<style>
  .tab-bar {
    display: flex;
    align-items: center;
    gap: 2px;
    max-width: 100%;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 0 4px;
    scroll-behavior: smooth;
    flex-shrink: 0;
  }
  /* Thin scrollbar that appears on hover */
  .tab-bar::-webkit-scrollbar { height: 3px; }
  .tab-bar::-webkit-scrollbar-track { background: transparent; }
  .tab-bar::-webkit-scrollbar-thumb { background: transparent; border-radius: 2px; }
  .tab-bar:hover::-webkit-scrollbar-thumb { background: #333; }
  .tab-bar:hover::-webkit-scrollbar-thumb:hover { background: #555; }

  .tab {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 5px 8px 5px 12px;
    border-radius: 6px;
    white-space: nowrap;
    font-size: 12px;
    color: #999;
    transition: all 120ms ease;
    border: 1px solid transparent;
    background: transparent;
    flex-shrink: 0;
  }
  .tab:hover { background: #222; color: #e6e6e6; }
  .tab.active { background: #1a1a1a; color: #e6e6e6; border-color: #262626; }

  .tab-body {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }

  .tab-icon { display: flex; align-items: center; }
  .tab-icon.claude { color: #c084fc; }
  .tab-icon.doc { color: #60a5fa; }

  .tab-title { max-width: 140px; overflow: hidden; text-overflow: ellipsis; }

  .tab-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 3px;
    border: none;
    background: transparent;
    color: #666;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 0;
  }
  .tab-close:hover { background: #2a2a2a; color: #e6e6e6; }

  .tab-sep {
    width: 1px; height: 16px; background: #333; margin: 0 4px; flex-shrink: 0;
  }
</style>
