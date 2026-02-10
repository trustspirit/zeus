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
    display: flex;
    align-items: center;
    justify-content: center;
    background: #0d0d0d;
  }
  .content { text-align: center; max-width: 480px; }
  .icon { color: #c084fc; margin-bottom: 20px; opacity: 0.8; }
  h1 { font-size: 28px; font-weight: 600; color: #e6e6e6; margin-bottom: 8px; letter-spacing: -0.02em; }
  .subtitle { font-size: 15px; color: #999; margin-bottom: 32px; }

  .actions { display: flex; gap: 12px; justify-content: center; margin-bottom: 36px; }

  .btn {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 20px; border: 1px solid #333; background: #1a1a1a;
    color: #e6e6e6; border-radius: 8px; cursor: pointer;
    font-size: 14px; font-weight: 500; transition: all 120ms ease;
    font-family: inherit;
  }
  .btn:hover { background: #222; border-color: #444; transform: translateY(-1px); }
  .btn.primary {
    background: rgba(192, 132, 252, 0.15);
    border-color: rgba(192, 132, 252, 0.3);
    color: #c084fc;
  }
  .btn.primary:hover {
    background: rgba(192, 132, 252, 0.25);
    border-color: #c084fc;
  }

  .shortcuts { display: flex; flex-wrap: wrap; gap: 12px 24px; justify-content: center; }
  .shortcut { font-size: 12px; color: #666; display: flex; align-items: center; gap: 6px; }
  kbd {
    display: inline-block; padding: 2px 6px; font-size: 11px;
    font-family: 'D2Coding', 'JetBrains Mono', 'SF Mono', monospace;
    color: #999; background: #1a1a1a; border: 1px solid #333;
    border-radius: 4px; line-height: 1.4;
  }
</style>
