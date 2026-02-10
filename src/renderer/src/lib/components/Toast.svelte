<script lang="ts">
  import { uiStore } from '../stores/ui.svelte.js'
</script>

{#each uiStore.toasts as toast (toast.id)}
  <div class="toast {toast.type}">{toast.message}</div>
{/each}

<style>
  .toast {
    position: fixed; bottom: 48px; right: 20px;
    background: #2c313a; border: 1px solid #4b5263; border-radius: 8px;
    padding: 12px 16px; font-size: 13px; color: #abb2bf;
    z-index: 300; box-shadow: 0 8px 30px rgba(0, 0, 0, 0.6);
    max-width: 400px; animation: slideUp 0.3s ease;
  }
  .toast.success { border-left: 3px solid #98c379; }
  .toast.error { border-left: 3px solid #e06c75; }
  .toast.info { border-left: 3px solid #6098d0; }

  @keyframes slideUp {
    from { transform: translateY(20px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }
</style>
