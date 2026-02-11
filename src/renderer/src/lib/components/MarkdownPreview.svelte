<script lang="ts">
  import { markdownStore } from '../stores/markdown.svelte.js'
  import { workspaceStore } from '../stores/workspace.svelte.js'
  import type { MarkdownFile } from '../types/index.js'

  // Reload file list when workspace changes
  $effect(() => {
    const ws = workspaceStore.active
    if (ws) {
      markdownStore.loadFiles(ws.path)
    } else {
      markdownStore.reset()
    }
  })

  /** Track collapsed folders */
  let collapsed = $state<Set<string>>(new Set())

  function toggleFolder(dir: string) {
    const next = new Set(collapsed)
    if (next.has(dir)) next.delete(dir)
    else next.add(dir)
    collapsed = next
  }

  function openFile(file: MarkdownFile) {
    markdownStore.openFile(file)
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  /** Split dir path into segments for breadcrumb-style display */
  function dirSegments(dir: string): string[] {
    if (dir === '.') return []
    return dir.split('/')
  }

  const totalCount = $derived(markdownStore.files.length)
  const groupEntries = $derived([...markdownStore.groupedFiles])
</script>

<div class="docs-browser">
  <div class="browser-header">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
    <span class="header-title">Claude Docs</span>
    {#if totalCount > 0}
      <span class="header-count">{totalCount} files</span>
    {/if}
  </div>

  {#if !workspaceStore.active}
    <div class="empty">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
      <p>Select a workspace to browse docs.</p>
    </div>
  {:else if markdownStore.loading}
    <div class="loading"><div class="spinner"></div></div>
  {:else if totalCount === 0}
    <div class="empty">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      <p>No Claude docs found.<br />Add files to <code>.claude/</code> or <code>CLAUDE.md</code>.</p>
    </div>
  {:else}
    <div class="file-tree">
      {#each groupEntries as [dir, files], groupIdx (dir)}
        <div class="folder-group" class:first={groupIdx === 0}>
          <!-- Folder header -->
          <button class="folder-header" onclick={() => toggleFolder(dir)}>
            <svg
              width="10" height="10" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2.5"
              class="chevron"
              class:open={!collapsed.has(dir)}
            ><polyline points="9 18 15 12 9 6"/></svg>

            <div class="folder-label">
              {#if dir === '.'}
                <span class="folder-badge root">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                  /
                </span>
              {:else}
                <span class="folder-path">
                  {#each dirSegments(dir) as seg, i}
                    {#if i > 0}<span class="path-sep">/</span>{/if}
                    <span class="path-seg" class:last={i === dirSegments(dir).length - 1}>{seg}</span>
                  {/each}
                </span>
              {/if}
            </div>

            <span class="folder-count">{files.length}</span>
          </button>

          <!-- Files -->
          {#if !collapsed.has(dir)}
            <div class="folder-files">
              {#each files as file (file.path)}
                <button
                  class="file-item"
                  class:active={file.path === markdownStore.activeDocId}
                  onclick={() => openFile(file)}
                >
                  <div class="file-left">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="file-icon"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    <div class="file-info">
                      <span class="file-name">{file.name}</span>
                      <span class="file-relpath">{file.relativePath}</span>
                    </div>
                  </div>
                  <span class="file-size">{formatSize(file.size)}</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .docs-browser { height: 100%; display: flex; flex-direction: column; overflow: hidden; }

  .browser-header {
    display: flex; align-items: center; gap: 6px;
    padding: 12px 12px 10px; flex-shrink: 0;
    color: var(--text-muted);
  }
  .header-title {
    font-size: 11px; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.04em; color: var(--text-muted); flex: 1;
  }
  .header-count {
    font-size: 10px; color: var(--border-strong);
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
  }

  /* ── Loading / Empty ── */
  .loading { display: flex; justify-content: center; padding: 32px; }
  .spinner {
    width: 18px; height: 18px; border: 2px solid var(--border-strong);
    border-top-color: var(--accent); border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .empty {
    display: flex; flex-direction: column; align-items: center;
    padding: 32px 16px; color: var(--text-muted); text-align: center; gap: 10px;
  }
  .empty p { font-size: 12px; margin: 0; }

  /* ── File tree ── */
  .file-tree { flex: 1; overflow-y: auto; padding: 0 6px 12px; }

  /* ── Folder group ── */
  .folder-group {
    margin-bottom: 0;
    border-top: 1px solid var(--border-subtle);
    padding-top: 4px;
  }
  .folder-group.first { border-top: none; padding-top: 0; }

  .folder-header {
    display: flex; align-items: center; gap: 6px;
    width: 100%; padding: 7px 8px; border: none;
    background: rgba(255,255,255,0.02); color: var(--text-secondary); cursor: pointer;
    border-radius: 5px; font-size: 11px; font-weight: 500;
    font-family: inherit; transition: all 100ms ease;
  }
  .folder-header:hover { background: rgba(255,255,255,0.04); color: var(--text-primary); }

  .chevron {
    transition: transform 150ms ease; flex-shrink: 0; color: var(--border-strong);
  }
  .chevron.open { transform: rotate(90deg); }

  .folder-label { flex: 1; min-width: 0; display: flex; align-items: center; }

  .folder-badge {
    display: inline-flex; align-items: center; gap: 3px;
    font-size: 11px; font-weight: 600;
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
    color: var(--blue);
  }
  .folder-badge.root { color: var(--blue); }

  /* Path breadcrumb */
  .folder-path {
    display: flex; align-items: center; gap: 0;
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
    font-size: 11px; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .path-sep { color: var(--border-strong); margin: 0 2px; }
  .path-seg { color: var(--border-strong); }
  .path-seg.last { color: var(--yellow); font-weight: 600; }

  .folder-count {
    font-size: 9px; color: var(--border-strong); background: var(--bg-raised);
    padding: 1px 5px; border-radius: 6px; flex-shrink: 0;
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
  }

  /* ── Files ── */
  .folder-files { padding: 2px 0 6px 18px; }

  .file-item {
    display: flex; align-items: center; justify-content: space-between;
    gap: 6px; width: 100%; padding: 6px 8px; border: none;
    background: transparent; color: inherit; cursor: pointer;
    border-radius: 5px; font-family: inherit;
    text-align: left; transition: all 100ms ease;
    border-left: 2px solid transparent;
  }
  .file-item:hover {
    background: rgba(255,255,255,0.025);
    border-left-color: var(--border-strong);
  }
  .file-item.active {
    background: var(--accent-bg-subtle);
    border-left-color: var(--accent);
  }

  .file-left {
    display: flex; align-items: flex-start; gap: 8px;
    min-width: 0; flex: 1;
  }

  .file-icon { color: var(--blue); flex-shrink: 0; margin-top: 1px; }
  .file-item.active .file-icon { color: var(--accent); }

  .file-info {
    display: flex; flex-direction: column; gap: 1px; min-width: 0;
  }

  .file-name {
    font-size: 12px; font-weight: 500; color: var(--text-primary);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .file-item:hover .file-name { color: var(--text-primary); }
  .file-item.active .file-name { color: var(--text-primary); font-weight: 600; }

  .file-relpath {
    font-size: 10px; color: var(--border-strong);
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .file-item:hover .file-relpath { color: var(--text-muted); }
  .file-item.active .file-relpath { color: var(--text-dim); }

  .file-size {
    font-size: 10px; color: var(--border-strong); flex-shrink: 0;
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
  }
</style>
