<script lang="ts">
  import { uiStore } from '../stores/ui.svelte.js'
  import IconSidebar from './icons/IconSidebar.svelte'
  import IconCode from './icons/IconCode.svelte'
  import IconFolder from './icons/IconFolder.svelte'
  import IconPanelRight from './icons/IconPanelRight.svelte'

  let { onopenIDE, onreveal, ontogglePanel }: {
    onopenIDE: () => void
    onreveal: () => void
    ontogglePanel: () => void
  } = $props()
</script>

<div class="toolbar">
  <div class="toolbar-left">
    <button class="icon-btn" title="Toggle sidebar (Cmd+B)" onclick={() => uiStore.toggleSidebar()}>
      <IconSidebar size={18} />
    </button>
  </div>

  <div class="toolbar-right">
    <button class="icon-btn" title="Open in IDE" onclick={onopenIDE}>
      <IconCode size={16} />
    </button>
    <button class="icon-btn" title="Reveal in Finder" onclick={onreveal}>
      <IconFolder size={16} />
    </button>
    <div class="divider"></div>
    <button class="icon-btn" title="Toggle panel (Cmd+I)" onclick={ontogglePanel}>
      <IconPanelRight size={16} />
    </button>
  </div>
</div>

<style>
  .toolbar {
    height: 38px; display: flex; align-items: center; justify-content: space-between;
    padding: 0 12px; background: #21252b; border-bottom: 1px solid #181a1f;
    -webkit-app-region: no-drag;
  }
  .toolbar-left, .toolbar-right { display: flex; align-items: center; gap: 6px; }

  .divider { width: 1px; height: 20px; background: #3e4451; margin: 0 4px; }

  .icon-btn {
    display: flex; align-items: center; justify-content: center;
    width: 30px; height: 30px; border: none; background: transparent;
    color: #7f848e; border-radius: 6px; cursor: pointer; transition: all 120ms ease;
  }
  .icon-btn:hover { background: #3e4451; color: #abb2bf; }
</style>
