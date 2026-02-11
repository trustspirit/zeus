<script lang="ts">
  import IconClaude from './icons/IconClaude.svelte'
  import IconFolder from './icons/IconFolder.svelte'
  import IconPlay from './icons/IconPlay.svelte'

  let { onaddWorkspace, onrunClaude }: {
    onaddWorkspace: () => void
    onrunClaude: () => void
  } = $props()
</script>

<div class="welcome">
  <div class="content">
    <div class="icon"><IconClaude size={64} /></div>
    <h1>Welcome to Zeus</h1>
    <p class="subtitle">Your command center for Claude Code</p>

    <div class="actions">
      <button class="btn primary" onclick={onaddWorkspace}>
        <IconFolder size={18} />
        <span>Add Workspace</span>
      </button>
      <button class="btn" onclick={onrunClaude}>
        <IconPlay size={18} />
        <span>Launch Claude Code</span>
      </button>
    </div>

    <div class="shortcuts">
      <div class="shortcut"><kbd>Cmd+T</kbd> New terminal</div>
      <div class="shortcut"><kbd>Cmd+Shift+C</kbd> Run Claude Code</div>
      <div class="shortcut"><kbd>Cmd+B</kbd> Toggle sidebar</div>
      <div class="shortcut"><kbd>Cmd+I</kbd> Skills / MCP / Docs</div>
      <div class="shortcut"><kbd>Cmd+K</kbd> Clear terminal</div>
    </div>
  </div>
</div>

<style>
  .welcome {
    position: absolute;
    inset: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-base);
  }
  .content { text-align: center; max-width: 480px; }
  .icon { color: var(--accent); margin-bottom: 20px; opacity: 0.9; }
  h1 { font-size: 28px; font-weight: 600; color: var(--text-primary); margin-bottom: 8px; letter-spacing: -0.02em; }
  .subtitle { font-size: 15px; color: var(--text-secondary); margin-bottom: 32px; }

  .actions { display: flex; gap: 12px; justify-content: center; margin-bottom: 36px; }

  .btn {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 20px; border: 1px solid var(--border); background: var(--bg-raised);
    color: var(--text-primary); border-radius: 8px; cursor: pointer;
    font-size: 14px; font-weight: 500; transition: all 120ms ease;
    font-family: inherit;
  }
  .btn:hover { background: var(--border); border-color: var(--border-strong); transform: translateY(-1px); }
  .btn.primary {
    background: var(--accent-bg);
    border-color: var(--accent-border);
    color: var(--accent);
  }
  .btn.primary:hover {
    background: var(--accent-bg-hover);
    border-color: var(--accent);
  }

  .shortcuts { display: flex; flex-wrap: wrap; gap: 12px 24px; justify-content: center; }
  .shortcut { font-size: 12px; color: var(--text-muted); display: flex; align-items: center; gap: 6px; }
  kbd {
    display: inline-block; padding: 2px 6px; font-size: 11px;
    font-family: 'D2Coding', 'JetBrains Mono', 'SF Mono', monospace;
    color: var(--text-secondary); background: var(--bg-raised); border: 1px solid var(--border);
    border-radius: 4px; line-height: 1.4;
  }
</style>
