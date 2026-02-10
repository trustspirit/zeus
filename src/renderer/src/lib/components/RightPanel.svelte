<script lang="ts">
  import { uiStore } from '../stores/ui.svelte.js'
  import SkillsPanel from './SkillsPanel.svelte'
  import MCPPanel from './MCPPanel.svelte'
  import MarkdownPreview from './MarkdownPreview.svelte'
  import IconSkills from './icons/IconSkills.svelte'
  import IconPlug from './icons/IconPlug.svelte'
  import IconDoc from './icons/IconDoc.svelte'

  const activeTab = $derived(uiStore.rightPanelTab)
</script>

<aside class="right-panel" class:collapsed={!uiStore.rightPanelOpen}>
  {#if uiStore.rightPanelOpen}
    <!-- Tab bar -->
    <div class="tab-strip">
      <button
        class="tab-btn" class:active={activeTab === 'skills'}
        onclick={() => (uiStore.rightPanelTab = 'skills')}
        title="Skills"
      >
        <IconSkills size={16} />
        <span>Skills</span>
      </button>
      <button
        class="tab-btn" class:active={activeTab === 'mcp'}
        onclick={() => (uiStore.rightPanelTab = 'mcp')}
        title="MCP Servers"
      >
        <IconPlug size={16} />
        <span>MCP</span>
      </button>
      <button
        class="tab-btn" class:active={activeTab === 'docs'}
        onclick={() => (uiStore.rightPanelTab = 'docs')}
        title="Docs"
      >
        <IconDoc size={16} />
        <span>Docs</span>
      </button>
    </div>

    <!-- Panel content -->
    <div class="panel-body">
      {#if activeTab === 'skills'}
        <SkillsPanel />
      {:else if activeTab === 'mcp'}
        <MCPPanel />
      {:else if activeTab === 'docs'}
        <MarkdownPreview />
      {/if}
    </div>
  {/if}
</aside>

<style>
  .right-panel {
    width: 320px;
    min-width: 320px;
    background: #21252b;
    border-left: 1px solid #181a1f;
    display: flex;
    flex-direction: column;
    transition: width 200ms ease, min-width 200ms ease, opacity 200ms ease;
    overflow: hidden;
  }
  .right-panel.collapsed {
    width: 0;
    min-width: 0;
    opacity: 0;
    border-left: none;
  }

  .tab-strip {
    display: flex;
    border-bottom: 1px solid #181a1f;
    flex-shrink: 0;
  }

  .tab-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 10px 8px;
    border: none;
    background: transparent;
    color: #5c6370;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 120ms ease;
    border-bottom: 2px solid transparent;
    font-family: inherit;
  }
  .tab-btn:hover { color: #abb2bf; background: #2c313a; }
  .tab-btn.active {
    color: #c678dd;
    border-bottom-color: #c678dd;
    background: rgba(198, 120, 221, 0.06);
  }

  .panel-body {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
</style>
