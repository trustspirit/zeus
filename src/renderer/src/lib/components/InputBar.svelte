<script lang="ts">
  import { claudeSessionStore } from '../stores/claude-session.svelte.js'
  import { workspaceStore } from '../stores/workspace.svelte.js'
  import { uiStore, AVAILABLE_MODELS } from '../stores/ui.svelte.js'
  import IconClaude from './icons/IconClaude.svelte'

  let inputEl: HTMLTextAreaElement
  let inputValue = $state('')
  let modelMenuOpen = $state(false)

  const currentModel = $derived(
    AVAILABLE_MODELS.find((m) => m.id === uiStore.selectedModel) ?? AVAILABLE_MODELS[0]
  )

  function selectModel(id: string) {
    uiStore.selectedModel = id
    modelMenuOpen = false
  }

  function toggleModelMenu() {
    modelMenuOpen = !modelMenuOpen
  }

  /** Close model menu when clicking outside */
  function handleWindowClick(e: MouseEvent) {
    const target = e.target as HTMLElement
    if (modelMenuOpen && !target.closest('.model-selector')) {
      modelMenuOpen = false
    }
  }

  const claudeConv = $derived(claudeSessionStore.activeConversation)
  const hasActiveTarget = $derived(!!claudeConv)
  const isStreaming = $derived(claudeConv?.isStreaming ?? false)

  /** Focus input when active conversation changes */
  $effect(() => {
    const _ = claudeConv?.id
    void _
    if (hasActiveTarget && inputEl) {
      requestAnimationFrame(() => inputEl?.focus())
    }
  })

  /** Pick up prefill text from uiStore (e.g. when a skill is selected).
   *  [A5] Only react when this InputBar has an active target. */
  $effect(() => {
    const seq = uiStore.prefillSeq
    const text = uiStore.inputPrefill
    void seq
    if (text && inputEl && hasActiveTarget) {
      inputValue = text
      uiStore.consumePrefill()
      requestAnimationFrame(() => {
        if (inputEl) {
          inputEl.focus()
          inputEl.selectionStart = inputEl.selectionEnd = inputEl.value.length
          handleInput()
        }
      })
    }
  })

  function send() {
    if (!inputValue.trim() || !claudeConv || isStreaming) return
    claudeSessionStore.send(claudeConv.id, inputValue)
    inputValue = ''
    resetHeight()
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!hasActiveTarget) return

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
      return
    }

    // Ctrl+C = abort streaming
    if (e.key === 'c' && e.ctrlKey && claudeConv) {
      e.preventDefault()
      claudeSessionStore.abort(claudeConv.id)
      inputValue = ''
      resetHeight()
      return
    }
  }

  function handleInput() {
    if (!inputEl) return
    inputEl.style.height = 'auto'
    inputEl.style.height = Math.min(inputEl.scrollHeight, 150) + 'px'
  }

  function resetHeight() {
    if (!inputEl) return
    inputEl.style.height = 'auto'
  }

  export function focus() {
    inputEl?.focus()
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<svelte:window onclick={handleWindowClick} />
<div class="input-bar">
  <div class="input-row">
    <div class="mode-icon">
      <IconClaude size={16} />
    </div>
    <span class="prompt">{'>'}</span>

    <textarea
      bind:this={inputEl}
      bind:value={inputValue}
      class="input-field"
      placeholder={isStreaming ? 'Claude is responding…' : 'Ask Claude...'}
      rows="1"
      oninput={handleInput}
      onkeydown={handleKeydown}
      spellcheck="false"
      autocomplete="off"
      disabled={isStreaming}
    ></textarea>

    <button
      class="send-btn"
      class:active={inputValue.trim().length > 0 && !isStreaming}
      onclick={send}
      disabled={!inputValue.trim() || isStreaming}
      title="Send (Enter)"
    >
      {#if isStreaming}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
      {:else}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
      {/if}
    </button>
  </div>

  <div class="hints">
    <!-- Model selector -->
    <div class="model-selector">
      <button class="model-btn" onclick={toggleModelMenu} title="Select model">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v6m0 6v6m-7.8-3.6 5.2-3m5.2-3 5.2-3M4.2 5.4l5.2 3m5.2 3 5.2 3"/></svg>
        <span>{currentModel.label}</span>
        <svg class="caret" class:open={modelMenuOpen} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      {#if modelMenuOpen}
        <div class="model-menu">
          {#each AVAILABLE_MODELS as model (model.id)}
            <button
              class="model-option"
              class:active={model.id === uiStore.selectedModel}
              onclick={() => selectModel(model.id)}
            >
              <span class="model-name">{model.label}</span>
              <span class="model-desc">{model.desc}</span>
              {#if model.id === uiStore.selectedModel}
                <svg class="check" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
              {/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <span class="hint"><kbd>Enter</kbd> send</span>
    <span class="hint"><kbd>Shift+Enter</kbd> newline</span>
    <span class="hint"><kbd>Ctrl+C</kbd> abort</span>
    {#if workspaceStore.active}
      <span class="hint ws">{workspaceStore.active.name}</span>
    {/if}
  </div>
</div>

<style>
  .input-bar {
    flex-shrink: 0;
    border-top: 1px solid #313244;
    background: #181825;
    padding: 12px 16px 8px;
  }

  .input-row {
    display: flex;
    align-items: center;
    gap: 10px;
    background: #1e1e2e;
    border: 1px solid #313244;
    border-radius: 12px;
    padding: 10px 12px;
    transition: border-color 200ms ease, box-shadow 200ms ease;
  }
  .input-row:focus-within {
    border-color: #cba6f7;
    box-shadow: 0 0 0 2px rgba(203, 166, 247, 0.12);
  }

  .mode-icon {
    display: flex; align-items: center; justify-content: center;
    width: 28px; height: 28px; border-radius: 8px;
    background: rgba(203, 166, 247, 0.15); color: #cba6f7; flex-shrink: 0;
  }

  .prompt {
    font-family: 'D2Coding', 'JetBrains Mono', 'SF Mono', monospace;
    font-size: 14px; font-weight: 600;
    color: #cba6f7; flex-shrink: 0; line-height: 28px;
    user-select: none;
  }

  .input-field {
    flex: 1; min-width: 0;
    background: transparent; border: none; outline: none;
    color: #cdd6f4; font-size: 14px; line-height: 28px;
    font-family: 'D2Coding', 'JetBrains Mono', 'SF Mono', 'Fira Code', monospace;
    resize: none; overflow-y: auto;
    max-height: 150px;
    padding: 0; margin: 0;
    scrollbar-width: thin;
  }
  .input-field::placeholder { color: #585b70; }
  .input-field::-webkit-scrollbar { width: 4px; }
  .input-field::-webkit-scrollbar-thumb { background: #45475a; border-radius: 2px; }

  .send-btn {
    width: 32px; height: 32px; border: none; border-radius: 8px;
    background: #313244; color: #585b70; cursor: default;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0; transition: all 150ms ease;
  }
  .send-btn.active {
    background: #cba6f7; color: #1e1e2e; cursor: pointer;
  }
  .send-btn.active:hover { background: #dbbff8; }

  /* ── Hints ── */
  .hints {
    display: flex; align-items: center; gap: 12px;
    padding: 6px 4px 0; flex-wrap: wrap;
  }
  .hint {
    font-size: 10px; color: #45475a;
  }
  .hint kbd {
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
    font-size: 10px; color: #585b70;
    background: #1e1e2e; padding: 1px 4px; border-radius: 3px;
    border: 1px solid #313244;
  }
  .hint.ws {
    margin-left: auto;
    color: #585b70;
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
  }

  /* ── Model Selector ── */
  .model-selector {
    position: relative;
  }
  .model-btn {
    display: flex; align-items: center; gap: 5px;
    padding: 3px 8px; border: 1px solid #313244; border-radius: 6px;
    background: #1e1e2e; color: #a6adc8;
    font-size: 11px; font-weight: 500; cursor: pointer;
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
    transition: all 120ms ease;
  }
  .model-btn:hover { border-color: #585b70; color: #cdd6f4; }
  .model-btn .caret {
    transition: transform 150ms ease;
  }
  .model-btn .caret.open { transform: rotate(180deg); }

  .model-menu {
    position: absolute; bottom: calc(100% + 6px); left: 0;
    min-width: 180px;
    background: #1e1e2e; border: 1px solid #313244;
    border-radius: 10px; padding: 4px;
    box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.4);
    z-index: 100;
  }
  .model-option {
    display: flex; align-items: center; gap: 8px;
    width: 100%; padding: 8px 10px; border: none; border-radius: 7px;
    background: transparent; color: #a6adc8; cursor: pointer;
    text-align: left; font-family: inherit;
    transition: background 100ms ease;
  }
  .model-option:hover { background: #313244; color: #cdd6f4; }
  .model-option.active { color: #cba6f7; }

  .model-name {
    font-size: 12px; font-weight: 600;
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
  }
  .model-desc {
    font-size: 10px; color: #585b70; flex: 1;
  }
  .model-option.active .model-desc { color: #7f849c; }
  .check { color: #cba6f7; flex-shrink: 0; }
</style>
