<script lang="ts">
  import { claudeStore } from '../stores/claude.svelte.js'
  import { uiStore } from '../stores/ui.svelte.js'

  type Phase = 'checking' | 'up-to-date' | 'update-available' | 'updating' | 'done' | 'error'

  let phase = $state<Phase>('checking')
  let currentVersion = $state<string | null>(null)
  let latestVersion = $state<string | null>(null)
  let updateResult = $state<{ success: boolean; output?: string; error?: string } | null>(null)

  // Auto-check when modal opens
  $effect(() => {
    if (uiStore.updateModalOpen) {
      phase = 'checking'
      currentVersion = null
      latestVersion = null
      updateResult = null
      checkForUpdate()
    }
  })

  async function checkForUpdate() {
    phase = 'checking'
    try {
      const info = await window.zeus.claude.checkLatest()
      currentVersion = info.current
      latestVersion = info.latest

      if (info.upToDate) {
        phase = 'up-to-date'
      } else if (info.latest) {
        phase = 'update-available'
      } else {
        // Couldn't determine latest — offer to update anyway
        phase = 'update-available'
      }
    } catch {
      phase = 'error'
      updateResult = { success: false, error: 'Failed to check for updates.' }
    }
  }

  async function runUpdate() {
    phase = 'updating'
    updateResult = null
    const result = await claudeStore.update()
    updateResult = result
    if (result.success) {
      phase = 'done'
      uiStore.showToast('Claude Code updated successfully', 'success')
    } else {
      phase = 'error'
      uiStore.showToast('Failed to update Claude Code', 'error')
    }
  }

  function close() {
    uiStore.updateModalOpen = false
    updateResult = null
  }
</script>

{#if uiStore.updateModalOpen}
  <div class="modal">
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="backdrop" onclick={close}></div>
    <div class="content">
      <div class="header">
        <h2>Update Claude Code</h2>
        <button class="close-btn" onclick={close}>&times;</button>
      </div>
      <div class="body">
        <!-- Checking -->
        {#if phase === 'checking'}
          <div class="status-row">
            <div class="spinner"></div>
            <p>Checking for updates…</p>
          </div>

        <!-- Up to date -->
        {:else if phase === 'up-to-date'}
          <div class="result-block up-to-date">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            <div class="result-info">
              <p class="result-title">Already up to date</p>
              <p class="result-version">v{currentVersion ?? '?'}</p>
            </div>
          </div>

        <!-- Update available -->
        {:else if phase === 'update-available'}
          <div class="result-block update-available">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            <div class="result-info">
              <p class="result-title">Update available</p>
              <div class="version-compare">
                <span class="ver-current">{currentVersion ?? '?'}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                <span class="ver-latest">{latestVersion ?? '?'}</span>
              </div>
            </div>
          </div>
          <div class="action-row">
            <button class="btn secondary" onclick={close}>Later</button>
            <button class="btn primary" onclick={runUpdate}>Update Now</button>
          </div>

        <!-- Updating -->
        {:else if phase === 'updating'}
          <div class="status-row">
            <div class="spinner"></div>
            <p>Updating to v{latestVersion ?? 'latest'}…</p>
          </div>

        <!-- Done -->
        {:else if phase === 'done'}
          <div class="result-block up-to-date">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            <div class="result-info">
              <p class="result-title">Updated successfully!</p>
              <p class="result-version">v{claudeStore.version ?? latestVersion ?? '?'}</p>
            </div>
          </div>
          {#if updateResult?.output}
            <pre class="output">{updateResult.output}</pre>
          {/if}

        <!-- Error -->
        {:else if phase === 'error'}
          <div class="result-block error-block">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--red)" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
            <div class="result-info">
              <p class="result-title error-text">Update failed</p>
            </div>
          </div>
          <pre class="output">{updateResult?.error ?? 'Unknown error'}</pre>
          <div class="action-row">
            <button class="btn secondary" onclick={close}>Close</button>
            <button class="btn primary" onclick={runUpdate}>Retry</button>
          </div>
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
    border-radius: 12px; width: 380px; max-height: 80vh;
    overflow: hidden; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
  }
  .header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 20px; border-bottom: 1px solid var(--border);
  }
  h2 { font-size: 15px; font-weight: 600; color: var(--text-primary); margin: 0; }
  .close-btn {
    display: flex; align-items: center; justify-content: center;
    width: 28px; height: 28px; border: none; background: transparent;
    color: var(--text-muted); border-radius: 6px; cursor: pointer; font-size: 20px;
  }
  .close-btn:hover { background: var(--border); color: var(--text-primary); }
  .body { padding: 20px; }

  .status-row {
    display: flex; align-items: center; gap: 12px; padding: 12px 0;
  }
  .status-row p { color: var(--text-primary); font-size: 13px; margin: 0; }

  .spinner {
    width: 18px; height: 18px; border: 2px solid var(--border);
    border-top-color: var(--accent); border-radius: 50%;
    animation: spin 0.8s linear infinite; flex-shrink: 0;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .result-block {
    display: flex; align-items: center; gap: 14px;
    padding: 16px 0;
  }
  .result-info { flex: 1; }
  .result-title {
    font-size: 14px; font-weight: 600; color: var(--text-primary); margin: 0 0 4px;
  }
  .result-version {
    font-size: 12px; color: var(--text-muted); margin: 0;
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
  }

  .version-compare {
    display: flex; align-items: center; gap: 6px;
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
    font-size: 12px;
  }
  .ver-current { color: var(--text-muted); }
  .ver-latest { color: var(--green); font-weight: 600; }

  .error-text { color: var(--red) !important; }

  .action-row {
    display: flex; gap: 8px; justify-content: flex-end;
    margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border);
  }
  .btn {
    padding: 7px 16px; border: 1px solid var(--border-strong); border-radius: 6px;
    font-size: 12px; font-weight: 500; cursor: pointer; font-family: inherit;
  }
  .btn.secondary { background: transparent; color: var(--text-secondary); }
  .btn.secondary:hover { background: var(--border); color: var(--text-primary); }
  .btn.primary {
    background: var(--accent-bg); border-color: var(--accent-border);
    color: var(--accent);
  }
  .btn.primary:hover { background: var(--accent-bg-hover); }

  .output {
    margin-top: 8px;
    font-family: 'D2Coding', 'JetBrains Mono', 'SF Mono', monospace;
    font-size: 11px; color: var(--text-muted);
    white-space: pre-wrap; max-height: 200px; overflow-y: auto;
    background: var(--bg-surface); padding: 8px; border-radius: 6px;
  }
</style>
