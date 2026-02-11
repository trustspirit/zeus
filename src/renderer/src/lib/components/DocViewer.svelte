<script lang="ts">
  import { marked } from 'marked'
  import DOMPurify from 'dompurify'
  import { markdownStore } from '../stores/markdown.svelte.js'
  import { workspaceStore } from '../stores/workspace.svelte.js'

  const renderedHtml = $derived.by(() => {
    const tab = markdownStore.activeTab
    if (!tab || !tab.content) return ''
    try {
      const raw = marked.parse(tab.content, { async: false }) as string
      return DOMPurify.sanitize(raw, { ADD_TAGS: ['details', 'summary'] })
    } catch {
      return '<p style="color:var(--red);">Failed to parse markdown</p>'
    }
  })

  const breadcrumb = $derived.by(() => {
    const tab = markdownStore.activeTab
    if (!tab) return ''
    const ws = workspaceStore.active
    if (ws) {
      return tab.file.relativePath || tab.file.name
    }
    return tab.file.path.replace(/^\/Users\/[^/]+/, '~')
  })

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }
</script>

{#if markdownStore.activeTab}
  <div class="doc-viewer">
    <!-- Breadcrumb header -->
    <div class="doc-header">
      <div class="doc-breadcrumb">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="doc-icon"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <span class="breadcrumb-path">{breadcrumb}</span>
        <span class="breadcrumb-size">{formatSize(markdownStore.activeTab.file.size)}</span>
      </div>
      <button class="reload-btn" title="Reload" onclick={() => markdownStore.reloadActive()}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
      </button>
    </div>

    <!-- Rendered content -->
    <div class="doc-body">
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      <article class="markdown-content">{@html renderedHtml}</article>
    </div>
  </div>
{/if}

<style>
  .doc-viewer {
    flex: 1; width: 100%; height: 100%;
    display: flex; flex-direction: column;
    background: var(--bg-base); overflow: hidden;
  }

  .doc-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 20px; border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0; background: var(--bg-surface);
  }

  .doc-breadcrumb {
    display: flex; align-items: center; gap: 8px; min-width: 0;
  }
  .doc-icon { color: var(--blue); flex-shrink: 0; }
  .breadcrumb-path {
    font-size: 12px; color: var(--text-secondary);
    font-family: 'D2Coding', 'JetBrains Mono', 'SF Mono', monospace;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .breadcrumb-size {
    font-size: 11px; color: var(--text-muted); flex-shrink: 0;
  }

  .reload-btn {
    width: 28px; height: 28px; border: none; border-radius: 6px;
    background: transparent; color: var(--text-muted); cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: all 120ms ease; flex-shrink: 0;
  }
  .reload-btn:hover { background: var(--bg-raised); color: var(--text-primary); }

  /* Scrollable body with comfortable max-width */
  .doc-body {
    flex: 1; overflow-y: auto; padding: 24px 32px 48px;
    display: flex; justify-content: center;
    user-select: text;
    -webkit-user-select: text;
  }

  .markdown-content {
    max-width: 820px; width: 100%;
    font-size: 15px; line-height: 1.75; color: var(--text-primary);
    font-family: 'Pretendard Variable', Pretendard, -apple-system, sans-serif;
    overflow-wrap: break-word; word-break: break-word;
  }

  /* ── Markdown styles ─────────────────────────────────────────── */
  .markdown-content :global(h1) {
    font-size: 28px; font-weight: 700; color: var(--yellow);
    margin: 32px 0 16px; padding-bottom: 10px; border-bottom: 1px solid var(--border);
  }
  .markdown-content :global(h2) {
    font-size: 22px; font-weight: 600; color: var(--yellow); margin: 28px 0 12px;
    padding-bottom: 8px; border-bottom: 1px solid var(--border);
  }
  .markdown-content :global(h3) { font-size: 18px; font-weight: 600; color: var(--yellow); margin: 24px 0 8px; }
  .markdown-content :global(h4) { font-size: 15px; font-weight: 600; color: var(--orange); margin: 20px 0 6px; }
  .markdown-content :global(p) { margin: 0 0 16px; }
  .markdown-content :global(a) { color: var(--blue); text-decoration: none; }
  .markdown-content :global(a:hover) { text-decoration: underline; }
  .markdown-content :global(strong) { font-weight: 600; color: var(--orange); }
  .markdown-content :global(em) { font-style: italic; }
  .markdown-content :global(code) {
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
    background: var(--bg-surface); color: var(--red); padding: 2px 6px; border-radius: 4px;
    border: 1px solid var(--border);
    font-size: 0.88em;
  }
  .markdown-content :global(pre) {
    background: var(--bg-deep); border: 1px solid var(--border); border-radius: 10px;
    padding: 16px 20px; margin: 0 0 20px;
    overflow-x: hidden; white-space: pre-wrap; word-break: break-word;
  }
  .markdown-content :global(pre code) {
    background: none; padding: 0; color: var(--text-primary); font-size: 13px; line-height: 1.6;
    white-space: pre-wrap; word-break: break-word;
  }
  .markdown-content :global(blockquote) {
    border-left: 3px solid var(--border-strong); padding: 8px 20px; margin: 0 0 16px;
    color: var(--text-secondary); background: rgba(75, 82, 99, 0.1); border-radius: 0 6px 6px 0;
  }
  .markdown-content :global(ul), .markdown-content :global(ol) {
    padding-left: 28px; margin: 0 0 16px;
  }
  .markdown-content :global(li) { margin: 6px 0; }
  .markdown-content :global(table) {
    width: 100%; border-collapse: collapse; margin: 0 0 20px; font-size: 14px;
    table-layout: fixed; word-break: break-word;
  }
  .markdown-content :global(th) {
    text-align: left; padding: 10px 14px; border-bottom: 2px solid var(--border);
    color: var(--text-primary); font-weight: 600;
  }
  .markdown-content :global(td) {
    padding: 8px 14px; border-bottom: 1px solid var(--bg-raised);
  }
  .markdown-content :global(tr:hover td) { background: rgba(255,255,255,0.02); }
  .markdown-content :global(hr) {
    border: none; border-top: 1px solid var(--border); margin: 32px 0;
  }
  .markdown-content :global(img) {
    max-width: 100%; border-radius: 8px; margin: 12px 0;
  }
  .markdown-content :global(li > input[type="checkbox"]) {
    margin-right: 8px;
  }
</style>
