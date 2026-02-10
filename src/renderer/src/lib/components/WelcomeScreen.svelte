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
    background: #282c34;
  }
  .content { text-align: center; max-width: 480px; }
  .icon { color: #c678dd; margin-bottom: 20px; opacity: 0.9; }
  h1 { font-size: 28px; font-weight: 600; color: #abb2bf; margin-bottom: 8px; letter-spacing: -0.02em; }
  .subtitle { font-size: 15px; color: #7f848e; margin-bottom: 32px; }

  .actions { display: flex; gap: 12px; justify-content: center; margin-bottom: 36px; }

  .btn {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 20px; border: 1px solid #3e4451; background: #2c313a;
    color: #abb2bf; border-radius: 8px; cursor: pointer;
    font-size: 14px; font-weight: 500; transition: all 120ms ease;
    font-family: inherit;
  }
  .btn:hover { background: #3e4451; border-color: #4b5263; transform: translateY(-1px); }
  .btn.primary {
    background: rgba(198, 120, 221, 0.12);
    border-color: rgba(198, 120, 221, 0.3);
    color: #c678dd;
  }
  .btn.primary:hover {
    background: rgba(198, 120, 221, 0.2);
    border-color: #c678dd;
  }

  .shortcuts { display: flex; flex-wrap: wrap; gap: 12px 24px; justify-content: center; }
  .shortcut { font-size: 12px; color: #5c6370; display: flex; align-items: center; gap: 6px; }
  kbd {
    display: inline-block; padding: 2px 6px; font-size: 11px;
    font-family: 'D2Coding', 'JetBrains Mono', 'SF Mono', monospace;
    color: #7f848e; background: #2c313a; border: 1px solid #3e4451;
    border-radius: 4px; line-height: 1.4;
  }
</style>
