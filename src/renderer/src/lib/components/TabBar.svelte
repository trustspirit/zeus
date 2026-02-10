<script lang="ts">
  import { terminalStore } from '../stores/terminal.svelte.js'
  import { claudeSessionStore } from '../stores/claude-session.svelte.js'
  import { markdownStore } from '../stores/markdown.svelte.js'
  import { uiStore } from '../stores/ui.svelte.js'
  import IconClaude from './icons/IconClaude.svelte'
  import IconTerminal from './icons/IconTerminal.svelte'

  let tabBarEl: HTMLDivElement

  function switchToTerminal(id: number) {
    terminalStore.switchTo(id)
    uiStore.activeView = 'terminal'
    requestAnimationFrame(() => terminalStore.focusActive())
  }

  function switchToClaude(id: string) {
    claudeSessionStore.switchTo(id)
  }

  function switchToDoc(id: string) {
    void markdownStore.switchTo(id)
  }

  function closeTerminal(e: MouseEvent, id: number) {
    e.stopPropagation()
    terminalStore.close(id)
  }

  function closeClaude(e: MouseEvent, id: string) {
    e.stopPropagation()
    claudeSessionStore.close(id)
  }

  function closeDoc(e: MouseEvent, id: string) {
    e.stopPropagation()
    markdownStore.close(id)
  }

  /** Middle-click (wheel button) closes tabs */
  function handleTerminalAuxClick(e: MouseEvent, id: number) {
    if (e.button === 1) { e.preventDefault(); terminalStore.close(id) }
  }
  function handleClaudeAuxClick(e: MouseEvent, id: string) {
    if (e.button === 1) { e.preventDefault(); claudeSessionStore.close(id) }
  }
  function handleDocAuxClick(e: MouseEvent, id: string) {
    if (e.button === 1) { e.preventDefault(); markdownStore.close(id) }
  }

  /** Horizontal scroll with mouse wheel on the tab bar */
  function handleWheel(e: WheelEvent) {
    if (!tabBarEl) return
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault()
      tabBarEl.scrollLeft += e.deltaY
    }
  }

  const hasTerminals = $derived(terminalStore.sessions.length > 0)
  const hasClaude = $derived(claudeSessionStore.conversations.length > 0)
  const hasDocs = $derived(markdownStore.openTabs.length > 0)
  const hasContent = $derived(hasTerminals || hasClaude || hasDocs)
</script>

{#if hasContent}
<div class="tab-bar" bind:this={tabBarEl} onwheel={handleWheel}>
  <!-- Claude conversation tabs -->
  {#each claudeSessionStore.conversations as conv (conv.id)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="tab claude-tab"
      class:active={uiStore.activeView === 'claude' && conv.id === claudeSessionStore.activeId}
      onauxclick={(e) => handleClaudeAuxClick(e, conv.id)}
    >
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
      <div class="tab-body" onclick={() => switchToClaude(conv.id)}>
        <span class="tab-icon claude">
          <IconClaude size={14} />
        </span>
        <span class="tab-title">{conv.title}</span>
        {#if conv.isStreaming}
          <span class="streaming-dot"></span>
        {/if}
      </div>
      <button
        class="tab-close"
        onclick={(e) => closeClaude(e, conv.id)}
      >&times;</button>
    </div>
  {/each}

  <!-- Separator -->
  {#if hasClaude && hasTerminals}
    <div class="tab-sep"></div>
  {/if}

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
        <span class="tab-icon terminal">
          <IconTerminal size={14} />
        </span>
        <span class="tab-title">{session.title}</span>
      </div>
      <button
        class="tab-close"
        onclick={(e) => closeTerminal(e, session.id)}
      >&times;</button>
    </div>
  {/each}

  <!-- Doc tabs (if opened from panel) -->
  {#if hasDocs}
    {#if hasTerminals || hasClaude}
      <div class="tab-sep"></div>
    {/if}
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
  {/if}
</div>
{/if}

<style>
  .tab-bar {
    display: flex; align-items: center; gap: 2px;
    max-width: 100%; overflow-x: auto; overflow-y: hidden;
    padding: 0 4px; scroll-behavior: smooth; flex-shrink: 0;
  }
  .tab-bar::-webkit-scrollbar { height: 3px; }
  .tab-bar::-webkit-scrollbar-track { background: transparent; }
  .tab-bar::-webkit-scrollbar-thumb { background: transparent; border-radius: 2px; }
  .tab-bar:hover::-webkit-scrollbar-thumb { background: #4b5263; }
  .tab-bar:hover::-webkit-scrollbar-thumb:hover { background: #5c6370; }

  .tab {
    display: flex; align-items: center; gap: 2px;
    padding: 5px 8px 5px 12px; border-radius: 6px;
    white-space: nowrap; font-size: 12px; color: #7f848e;
    transition: all 120ms ease; border: 1px solid transparent;
    background: transparent; flex-shrink: 0;
  }
  .tab:hover { background: #2c313a; color: #abb2bf; }
  .tab.active { background: #2c313a; color: #abb2bf; border-color: #3e4451; }

  .tab-body { display: flex; align-items: center; gap: 6px; cursor: pointer; }

  .tab-icon { display: flex; align-items: center; }
  .tab-icon.claude { color: #c678dd; }
  .tab-icon.terminal { color: #61afef; }
  .tab-icon.doc { color: #61afef; }

  .streaming-dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: #c678dd; flex-shrink: 0;
    animation: stream-pulse 1.2s ease-in-out infinite;
  }
  @keyframes stream-pulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }

  .tab-title { max-width: 140px; overflow: hidden; text-overflow: ellipsis; }

  .tab-close {
    display: flex; align-items: center; justify-content: center;
    width: 16px; height: 16px; border-radius: 3px;
    border: none; background: transparent; color: #5c6370;
    cursor: pointer; font-size: 14px; line-height: 1; padding: 0;
  }
  .tab-close:hover { background: #3e4451; color: #abb2bf; }

  .tab-sep { width: 1px; height: 16px; background: #3e4451; margin: 0 4px; flex-shrink: 0; }
</style>
