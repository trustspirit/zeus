<script lang="ts">
  import { workspaceStore } from '../stores/workspace.svelte.js'
  import type { GitChangedFile } from '../types/index.js'

  let files = $state<GitChangedFile[]>([])
  let loading = $state(false)
  let selectedFile = $state<string | null>(null)
  let diffContent = $state<string>('')
  let diffLoading = $state(false)
  let isOpen = $state(false)

  export async function refresh() {
    if (!workspaceStore.active) return
    loading = true
    try {
      files = await window.zeus.git.changedFiles(workspaceStore.active.path)
    } catch {
      files = []
    }
    loading = false
  }

  export function toggle() {
    isOpen = !isOpen
    if (isOpen && files.length === 0) refresh()
  }

  export function show() {
    isOpen = true
    refresh()
  }

  export function hide() {
    isOpen = false
  }

  export function getFileCount(): number {
    return files.length
  }

  async function selectFile(filePath: string) {
    if (selectedFile === filePath) {
      selectedFile = null
      diffContent = ''
      return
    }
    if (!workspaceStore.active) return
    selectedFile = filePath
    diffLoading = true
    try {
      diffContent = await window.zeus.git.diffFile(workspaceStore.active.path, filePath)
    } catch {
      diffContent = ''
    }
    diffLoading = false
  }

  function statusIcon(status: GitChangedFile['status']): string {
    switch (status) {
      case 'added': return 'A'
      case 'deleted': return 'D'
      case 'renamed': return 'R'
      case 'modified': return 'M'
      default: return '?'
    }
  }

  function statusColor(status: GitChangedFile['status']): string {
    switch (status) {
      case 'added': return '#a6e3a1'
      case 'deleted': return '#f38ba8'
      case 'renamed': return '#89b4fa'
      case 'modified': return '#f9e2af'
      default: return '#7f848e'
    }
  }

  interface DiffLine {
    type: 'add' | 'remove' | 'context' | 'header' | 'info'
    content: string
    oldLine: number | null
    newLine: number | null
  }

  function parseDiff(raw: string): DiffLine[] {
    if (!raw) return []
    const lines = raw.split('\n')
    const result: DiffLine[] = []
    let oldLine = 0
    let newLine = 0

    for (const line of lines) {
      if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) {
        result.push({ type: 'info', content: line, oldLine: null, newLine: null })
      } else if (line.startsWith('@@')) {
        // Parse hunk header: @@ -10,5 +10,8 @@
        const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/)
        if (match) {
          oldLine = parseInt(match[1])
          newLine = parseInt(match[2])
        }
        result.push({ type: 'header', content: line, oldLine: null, newLine: null })
      } else if (line.startsWith('+')) {
        result.push({ type: 'add', content: line.slice(1), oldLine: null, newLine: newLine++ })
      } else if (line.startsWith('-')) {
        result.push({ type: 'remove', content: line.slice(1), oldLine: oldLine++, newLine: null })
      } else {
        result.push({ type: 'context', content: line.startsWith(' ') ? line.slice(1) : line, oldLine: oldLine++, newLine: newLine++ })
      }
    }
    return result
  }

  const parsedDiff = $derived(parseDiff(diffContent))
  const totalAdditions = $derived(files.reduce((s, f) => s + f.additions, 0))
  const totalDeletions = $derived(files.reduce((s, f) => s + f.deletions, 0))
</script>

{#if isOpen}
  <div class="changed-files-panel">
    <div class="panel-header">
      <div class="panel-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
        <span>Changed Files</span>
        <span class="file-count">{files.length}</span>
      </div>
      <div class="panel-stats">
        {#if totalAdditions > 0}
          <span class="stat-add">+{totalAdditions}</span>
        {/if}
        {#if totalDeletions > 0}
          <span class="stat-del">-{totalDeletions}</span>
        {/if}
      </div>
      <div class="panel-actions">
        <button class="panel-action" onclick={refresh} title="Refresh">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        </button>
        <button class="panel-action" onclick={hide} title="Close">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>

    {#if loading}
      <div class="panel-loading">Scanning changes…</div>
    {:else if files.length === 0}
      <div class="panel-empty">No changes detected</div>
    {:else}
      <div class="file-list">
        {#each files as file (file.path)}
          <button
            class="file-item"
            class:active={selectedFile === file.path}
            onclick={() => selectFile(file.path)}
          >
            <span class="file-status" style="color: {statusColor(file.status)}">{statusIcon(file.status)}</span>
            <span class="file-path">{file.path}</span>
            <span class="file-changes">
              {#if file.additions > 0}<span class="ch-add">+{file.additions}</span>{/if}
              {#if file.deletions > 0}<span class="ch-del">-{file.deletions}</span>{/if}
            </span>
          </button>
        {/each}
      </div>

      {#if selectedFile}
        <div class="diff-viewer">
          <div class="diff-header">
            <span class="diff-file-name">{selectedFile}</span>
          </div>
          {#if diffLoading}
            <div class="diff-loading">Loading diff…</div>
          {:else if parsedDiff.length === 0}
            <div class="diff-empty">No diff available (file may be untracked)</div>
          {:else}
            <div class="diff-content">
              {#each parsedDiff as line}
                {#if line.type === 'header'}
                  <div class="diff-line diff-hunk">{line.content}</div>
                {:else if line.type === 'info'}
                  <div class="diff-line diff-info">{line.content}</div>
                {:else}
                  <div class="diff-line diff-{line.type}">
                    <span class="ln old">{line.oldLine ?? ''}</span>
                    <span class="ln new">{line.newLine ?? ''}</span>
                    <span class="diff-sign">{line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}</span>
                    <span class="diff-text">{line.content}</span>
                  </div>
                {/if}
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .changed-files-panel {
    border-top: 1px solid #3e4451;
    background: #1e2127;
    max-height: 50vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    animation: panel-slide-up 200ms ease;
  }
  @keyframes panel-slide-up {
    from { max-height: 0; opacity: 0; }
    to { max-height: 50vh; opacity: 1; }
  }

  .panel-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border-bottom: 1px solid #2c313a;
    flex-shrink: 0;
  }
  .panel-title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 600;
    color: #abb2bf;
  }
  .file-count {
    font-size: 10px;
    font-weight: 600;
    color: #e5c07b;
    background: rgba(229, 192, 123, 0.12);
    padding: 1px 6px;
    border-radius: 8px;
  }
  .panel-stats {
    display: flex;
    gap: 6px;
    font-size: 11px;
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
  }
  .stat-add { color: #a6e3a1; }
  .stat-del { color: #f38ba8; }

  .panel-actions {
    display: flex;
    gap: 4px;
    margin-left: auto;
  }
  .panel-action {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: #5c6370;
    cursor: pointer;
    transition: all 100ms ease;
  }
  .panel-action:hover {
    background: #2c313a;
    color: #abb2bf;
  }

  .panel-loading, .panel-empty {
    padding: 20px;
    text-align: center;
    color: #5c6370;
    font-size: 12px;
  }

  .file-list {
    overflow-y: auto;
    max-height: 180px;
    scrollbar-width: thin;
  }
  .file-list::-webkit-scrollbar { width: 4px; }
  .file-list::-webkit-scrollbar-thumb { background: #3e4451; border-radius: 2px; }

  .file-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 12px;
    border: none;
    background: transparent;
    color: #abb2bf;
    cursor: pointer;
    text-align: left;
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
    font-size: 12px;
    transition: background 80ms ease;
  }
  .file-item:hover { background: #2c313a; }
  .file-item.active {
    background: rgba(198, 120, 221, 0.08);
    border-left: 2px solid #c678dd;
  }

  .file-status {
    font-weight: 700;
    font-size: 11px;
    width: 14px;
    text-align: center;
    flex-shrink: 0;
  }
  .file-path {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .file-changes {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
    font-size: 10px;
  }
  .ch-add { color: #a6e3a1; }
  .ch-del { color: #f38ba8; }

  /* ── Diff Viewer ── */
  .diff-viewer {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    border-top: 1px solid #2c313a;
  }
  .diff-header {
    padding: 6px 12px;
    border-bottom: 1px solid #2c313a;
    font-size: 11px;
    color: #7f848e;
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
    flex-shrink: 0;
  }
  .diff-file-name { color: #abb2bf; }

  .diff-loading, .diff-empty {
    padding: 16px;
    text-align: center;
    color: #5c6370;
    font-size: 12px;
  }

  .diff-content {
    overflow: auto;
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
    font-size: 12px;
    line-height: 1.5;
    scrollbar-width: thin;
  }
  .diff-content::-webkit-scrollbar { width: 4px; height: 4px; }
  .diff-content::-webkit-scrollbar-thumb { background: #3e4451; border-radius: 2px; }

  .diff-line {
    display: flex;
    white-space: pre;
    min-width: fit-content;
  }
  .diff-line.diff-add {
    background: rgba(166, 227, 161, 0.08);
    color: #a6e3a1;
  }
  .diff-line.diff-remove {
    background: rgba(243, 139, 168, 0.08);
    color: #f38ba8;
  }
  .diff-line.diff-context { color: #5c6370; }
  .diff-line.diff-hunk {
    background: rgba(137, 180, 250, 0.06);
    color: #89b4fa;
    padding: 2px 12px;
    font-size: 11px;
  }
  .diff-line.diff-info {
    color: #4b5263;
    padding: 0 12px;
    font-size: 10px;
  }

  .ln {
    display: inline-block;
    width: 36px;
    text-align: right;
    padding-right: 8px;
    color: #3e4451;
    flex-shrink: 0;
    user-select: none;
  }
  .diff-sign {
    width: 14px;
    text-align: center;
    flex-shrink: 0;
    user-select: none;
  }
  .diff-text {
    flex: 1;
    padding-right: 12px;
  }
</style>
