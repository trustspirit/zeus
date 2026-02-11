<script lang="ts">
  import { uiStore, THEMES, type ThemeId } from '../stores/ui.svelte.js'

  function selectTheme(id: ThemeId) {
    uiStore.setTheme(id)
  }

  function handleOverlayClick(e: MouseEvent) {
    if ((e.target as HTMLElement).classList.contains('settings-overlay')) {
      uiStore.settingsOpen = false
    }
  }
</script>

{#if uiStore.settingsOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="settings-overlay" onclick={handleOverlayClick}>
    <div class="settings-panel">
      <div class="settings-header">
        <h2>Settings</h2>
        <button class="close-btn" onclick={() => (uiStore.settingsOpen = false)}>&times;</button>
      </div>

      <div class="settings-body">
        <!-- Theme Section -->
        <section class="settings-section">
          <h3>Theme</h3>
          <p class="section-desc">Choose a visual theme for the interface.</p>

          <div class="theme-grid">
            {#each THEMES as theme (theme.id)}
              <button
                class="theme-card"
                class:active={uiStore.theme === theme.id}
                onclick={() => selectTheme(theme.id)}
              >
                <div class="theme-preview {theme.id}">
                  <div class="tp-titlebar"></div>
                  <div class="tp-body">
                    <div class="tp-sidebar"></div>
                    <div class="tp-main">
                      <div class="tp-line short"></div>
                      <div class="tp-line long"></div>
                      <div class="tp-line medium"></div>
                    </div>
                  </div>
                </div>
                <div class="theme-info">
                  <span class="theme-name">{theme.label}</span>
                  <span class="theme-desc">{theme.desc}</span>
                </div>
                {#if uiStore.theme === theme.id}
                  <div class="theme-check">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                {/if}
              </button>
            {/each}
          </div>
        </section>
      </div>
    </div>
  </div>
{/if}

<style>
  .settings-overlay {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0, 0, 0, 0.55);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    animation: fade-in 150ms ease;
  }

  @keyframes fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .settings-panel {
    width: 520px;
    max-height: 80vh;
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: panel-in 200ms ease;
  }

  @keyframes panel-in {
    from { opacity: 0; transform: translateY(12px) scale(0.97); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  .settings-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 24px 16px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .settings-header h2 {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-bright);
    margin: 0;
  }

  .close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: 18px;
    transition: all 120ms ease;
  }
  .close-btn:hover {
    background: var(--bg-hover);
    color: var(--text-bright);
  }

  .settings-body {
    padding: 20px 24px 24px;
    overflow-y: auto;
  }

  .settings-section h3 {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-bright);
    margin: 0 0 4px;
  }

  .section-desc {
    font-size: 12px;
    color: var(--text-secondary);
    margin: 0 0 16px;
  }

  /* ── Theme Grid ── */
  .theme-grid {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .theme-card {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 12px 14px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    background: var(--bg-surface);
    cursor: pointer;
    transition: all 150ms ease;
    font-family: inherit;
    text-align: left;
    position: relative;
  }
  .theme-card:hover {
    border-color: var(--border);
    background: var(--bg-hover);
  }
  .theme-card.active {
    border-color: var(--accent);
    background: var(--accent-bg-subtle);
  }

  /* ── Theme Preview Thumbnail ── */
  .theme-preview {
    width: 80px;
    height: 52px;
    border-radius: 6px;
    overflow: hidden;
    flex-shrink: 0;
    border: 1px solid var(--border-subtle);
  }

  .tp-titlebar {
    height: 8px;
  }
  .tp-body {
    display: flex;
    height: calc(100% - 8px);
  }
  .tp-sidebar {
    width: 20px;
    flex-shrink: 0;
  }
  .tp-main {
    flex: 1;
    padding: 4px 5px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    justify-content: center;
  }
  .tp-line {
    height: 3px;
    border-radius: 1px;
  }
  .tp-line.short { width: 45%; }
  .tp-line.long { width: 80%; }
  .tp-line.medium { width: 60%; }

  /* Claude Code preview colors */
  .theme-preview.claude-code {
    background: #282c34;
  }
  .theme-preview.claude-code .tp-titlebar { background: #21252b; }
  .theme-preview.claude-code .tp-sidebar { background: #21252b; }
  .theme-preview.claude-code .tp-main { background: #282c34; }
  .theme-preview.claude-code .tp-line { background: #3e4451; }
  .theme-preview.claude-code .tp-line.short { background: #D97757; }

  /* Anthropic preview colors */
  .theme-preview.anthropic {
    background: #FAF7F2;
  }
  .theme-preview.anthropic .tp-titlebar { background: #F0ECE4; }
  .theme-preview.anthropic .tp-sidebar { background: #F0ECE4; }
  .theme-preview.anthropic .tp-main { background: #FAF7F2; }
  .theme-preview.anthropic .tp-line { background: #D8D2C8; }
  .theme-preview.anthropic .tp-line.short { background: #C1533C; }

  /* Claude Dark preview colors */
  .theme-preview.claude-dark {
    background: #1C1917;
  }
  .theme-preview.claude-dark .tp-titlebar { background: #171412; }
  .theme-preview.claude-dark .tp-sidebar { background: #171412; }
  .theme-preview.claude-dark .tp-main { background: #1C1917; }
  .theme-preview.claude-dark .tp-line { background: #352F2B; }
  .theme-preview.claude-dark .tp-line.short { background: #D97757; }

  /* ── Theme Info ── */
  .theme-info {
    flex: 1;
    min-width: 0;
  }
  .theme-name {
    display: block;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-bright);
  }
  .theme-desc {
    display: block;
    font-size: 11px;
    color: var(--text-secondary);
    margin-top: 2px;
  }

  .theme-check {
    flex-shrink: 0;
    color: var(--accent);
  }
</style>
