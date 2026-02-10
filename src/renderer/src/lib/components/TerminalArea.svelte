<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { terminalStore } from '../stores/terminal.svelte.js'
  import { uiStore } from '../stores/ui.svelte.js'

  let outputEl: HTMLDivElement

  // Resize observer — refit terminal when container size changes
  onMount(() => {
    const observer = new ResizeObserver(() => {
      if (uiStore.activeView === 'terminal') {
        terminalStore.fitActiveDebounced(50)
      }
    })
    observer.observe(outputEl)
    return () => observer.disconnect()
  })

  // When activeId changes or view switches to terminal, fit and focus xterm
  $effect(() => {
    const id = terminalStore.activeId
    const view = uiStore.activeView
    if (id !== null && view === 'terminal') {
      tick().then(() => {
        requestAnimationFrame(() => {
          try {
            const size = terminalStore.fitActive()
            if (size) uiStore.termSize = `${size.cols}x${size.rows}`
          } catch { /* terminal may not be attached yet */ }
          terminalStore.focusActive()
        })
      })
    }
  })
</script>

<div class="terminal-area" class:hidden={uiStore.activeView !== 'terminal'}>
  <div class="output-region" bind:this={outputEl}>
    {#each terminalStore.sessions as session (session.id)}
      <div
        class="terminal-wrapper"
        class:active={session.id === terminalStore.activeId}
        id="terminal-{session.id}"
      ></div>
    {/each}
  </div>
</div>

<style>
  .terminal-area {
    flex: 1;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: #1e1e2e;
  }
  .terminal-area.hidden {
    display: none;
  }

  .output-region {
    flex: 1;
    position: relative;
    overflow: hidden;
    min-height: 0;
  }

  .terminal-wrapper {
    position: absolute;
    inset: 0;
    display: none;
    padding: 8px 4px 4px 8px;
  }
  .terminal-wrapper.active { display: block; }

  .terminal-wrapper :global(.xterm) {
    height: 100%;
    padding: 0 8px;
  }
</style>
