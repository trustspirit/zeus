<script lang="ts">
  import { uiStore } from '../stores/ui.svelte.js'
</script>

{#each uiStore.toasts as toast (toast.id)}
  <div class="toast {toast.type}">{toast.message}</div>
{/each}

<style>
  .toast {
    position: fixed; bottom: 48px; right: 20px;
    background: var(--bg-raised); border: 1px solid var(--border-strong); border-radius: 8px;
    padding: 12px 16px; font-size: 13px; color: var(--text-primary);
    z-index: 300; box-shadow: 0 8px 30px rgba(0, 0, 0, 0.6);
    max-width: 400px; animation: slideUp 0.3s ease;
  }
  .toast.success { border-left: 3px solid var(--green); }
  .toast.error { border-left: 3px solid var(--red); }
  .toast.info { border-left: 3px solid var(--blue); }

  @keyframes slideUp {
    from { transform: translateY(20px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }
</style>
