<script lang="ts">
  import { terminalStore } from '../stores/terminal.svelte.js'
  import { workspaceStore } from '../stores/workspace.svelte.js'
  import IconBolt from './icons/IconBolt.svelte'
  import IconTerminal from './icons/IconTerminal.svelte'

  let inputEl: HTMLTextAreaElement
  let inputValue = $state('')

  const session = $derived(terminalStore.activeSession)
  const isClaude = $derived(session?.isClaude ?? false)

  /** Focus input when session changes */
  $effect(() => {
    if (session && inputEl) {
      requestAnimationFrame(() => inputEl?.focus())
    }
  })

  function send() {
    if (!session || !inputValue.trim()) return
    terminalStore.sendInput(session.id, inputValue)
    inputValue = ''
    resetHeight()
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!session) return

    // Enter = send (Shift+Enter = new line)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
      return
    }

    // Ctrl+C = send interrupt
    if (e.key === 'c' && e.ctrlKey) {
      e.preventDefault()
      terminalStore.sendRaw(session.id, '\x03')
      inputValue = ''
      resetHeight()
      return
    }

    // Ctrl+D = send EOF
    if (e.key === 'd' && e.ctrlKey) {
      e.preventDefault()
      terminalStore.sendRaw(session.id, '\x04')
      return
    }

    // Arrow Up = history previous
    if (e.key === 'ArrowUp' && !e.shiftKey) {
      const prev = terminalStore.historyUp(session.id)
      if (prev !== null) {
        e.preventDefault()
        inputValue = prev
        // Move cursor to end
        requestAnimationFrame(() => {
          if (inputEl) {
            inputEl.selectionStart = inputEl.selectionEnd = inputEl.value.length
          }
        })
      }
      return
    }

    // Arrow Down = history next
    if (e.key === 'ArrowDown' && !e.shiftKey) {
      const next = terminalStore.historyDown(session.id)
      if (next !== null) {
        e.preventDefault()
        inputValue = next
        requestAnimationFrame(() => {
          if (inputEl) {
            inputEl.selectionStart = inputEl.selectionEnd = inputEl.value.length
          }
        })
      }
      return
    }

    // Tab = send tab character
    if (e.key === 'Tab') {
      e.preventDefault()
      terminalStore.sendRaw(session.id, '\t')
      return
    }
  }

  /** Auto-resize textarea */
  function handleInput() {
    if (!inputEl) return
    inputEl.style.height = 'auto'
    const maxH = 150
    inputEl.style.height = Math.min(inputEl.scrollHeight, maxH) + 'px'
  }

  function resetHeight() {
    if (!inputEl) return
    inputEl.style.height = 'auto'
  }

  /** Expose focus method for parent */
  export function focus() {
    inputEl?.focus()
  }
</script>

<div class="input-bar" class:claude={isClaude}>
  <div class="input-row">
    <!-- Mode indicator -->
    <div class="mode-icon" class:claude={isClaude}>
      {#if isClaude}
        <IconBolt size={16} />
      {:else}
        <IconTerminal size={16} />
      {/if}
    </div>

    <!-- Prompt indicator -->
    <span class="prompt">{isClaude ? '>' : '$'}</span>

    <!-- Text input -->
    <textarea
      bind:this={inputEl}
      bind:value={inputValue}
      class="input-field"
      placeholder={isClaude ? 'Ask Claude...' : 'Enter command...'}
      rows="1"
      oninput={handleInput}
      onkeydown={handleKeydown}
      spellcheck="false"
      autocomplete="off"
    ></textarea>

    <!-- Send button -->
    <button
      class="send-btn"
      class:active={inputValue.trim().length > 0}
      onclick={send}
      disabled={!inputValue.trim()}
      title="Send (Enter)"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
    </button>
  </div>

  <!-- Hint bar -->
  <div class="hints">
    <span class="hint"><kbd>Enter</kbd> send</span>
    <span class="hint"><kbd>Shift+Enter</kbd> newline</span>
    <span class="hint"><kbd>↑↓</kbd> history</span>
    <span class="hint"><kbd>Ctrl+C</kbd> interrupt</span>
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
    align-items: flex-end;
    gap: 10px;
    background: #1e1e2e;
    border: 1px solid #313244;
    border-radius: 12px;
    padding: 10px 12px;
    transition: border-color 200ms ease, box-shadow 200ms ease;
  }
  .input-row:focus-within {
    border-color: #585b70;
    box-shadow: 0 0 0 2px rgba(137, 180, 250, 0.1);
  }
  .input-bar.claude .input-row:focus-within {
    border-color: #cba6f7;
    box-shadow: 0 0 0 2px rgba(203, 166, 247, 0.12);
  }

  .mode-icon {
    display: flex; align-items: center; justify-content: center;
    width: 28px; height: 28px; border-radius: 8px;
    background: #313244; color: #a6adc8; flex-shrink: 0;
  }
  .mode-icon.claude {
    background: rgba(203, 166, 247, 0.15); color: #cba6f7;
  }

  .prompt {
    font-family: 'D2Coding', 'JetBrains Mono', 'SF Mono', monospace;
    font-size: 14px; font-weight: 600;
    color: #585b70; flex-shrink: 0; line-height: 28px;
    user-select: none;
  }
  .input-bar.claude .prompt { color: #cba6f7; }

  .input-field {
    flex: 1; min-width: 0;
    background: transparent; border: none; outline: none;
    color: #cdd6f4; font-size: 14px; line-height: 1.5;
    font-family: 'D2Coding', 'JetBrains Mono', 'SF Mono', 'Fira Code', monospace;
    resize: none; overflow-y: auto;
    max-height: 150px;
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
    background: #89b4fa; color: #1e1e2e; cursor: pointer;
  }
  .send-btn.active:hover { background: #b4d0fb; }
  .input-bar.claude .send-btn.active {
    background: #cba6f7; color: #1e1e2e;
  }
  .input-bar.claude .send-btn.active:hover { background: #dbbff8; }

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
</style>
