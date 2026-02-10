<script lang="ts">
  import type { Workspace } from '../types/index.js'

  let {
    workspace,
    index,
    isActive,
    onselect,
    oncontextmenu,
    ondblclick,
    ondragstart,
    ondragover,
    ondragend,
    dragOverIndex
  }: {
    workspace: Workspace
    index: number
    isActive: boolean
    onselect: () => void
    oncontextmenu: (e: MouseEvent) => void
    ondblclick: () => void
    ondragstart: (e: DragEvent) => void
    ondragover: (e: DragEvent) => void
    ondragend: () => void
    dragOverIndex: number | null
  } = $props()

  const initial = $derived(workspace.name.charAt(0))
  const shortPath = $derived(workspace.path.replace(/^\/Users\/[^/]+/, '~'))
  const isDragOver = $derived(dragOverIndex === index)
</script>

<button
  class="workspace-item"
  class:active={isActive}
  class:drag-over={isDragOver}
  draggable="true"
  onclick={onselect}
  oncontextmenu={oncontextmenu}
  ondblclick={ondblclick}
  ondragstart={ondragstart}
  ondragover={ondragover}
  ondragend={ondragend}
>
  <div class="drag-handle" title="Drag to reorder">
    <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
      <circle cx="3" cy="2" r="1.2"/><circle cx="7" cy="2" r="1.2"/>
      <circle cx="3" cy="7" r="1.2"/><circle cx="7" cy="7" r="1.2"/>
      <circle cx="3" cy="12" r="1.2"/><circle cx="7" cy="12" r="1.2"/>
    </svg>
  </div>
  <div class="workspace-icon" class:active={isActive}>{initial}</div>
  <div class="workspace-details">
    <div class="workspace-name">{workspace.name}</div>
    <div class="workspace-path">{shortPath}</div>
  </div>
</button>

<style>
  .workspace-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 8px 8px 4px;
    border-radius: 6px;
    cursor: pointer;
    transition: background 120ms ease;
    border: none;
    background: transparent;
    width: 100%;
    text-align: left;
    color: inherit;
    font-family: inherit;
    border: 2px solid transparent;
  }
  .workspace-item:hover { background: #222; }
  .workspace-item.active { background: rgba(192, 132, 252, 0.15); }
  .workspace-item.active .workspace-name { color: #c084fc; }

  /* Drag-over indicator */
  .workspace-item.drag-over {
    border-top: 2px solid #c084fc;
    border-radius: 0;
  }

  /* Drag handle */
  .drag-handle {
    display: flex; align-items: center; justify-content: center;
    width: 16px; flex-shrink: 0;
    color: transparent;
    cursor: grab;
    transition: color 120ms ease;
  }
  .workspace-item:hover .drag-handle { color: #555; }
  .drag-handle:active { cursor: grabbing; }

  .workspace-icon {
    width: 32px;
    height: 32px;
    border-radius: 6px;
    background: #1a1a1a;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: #999;
    font-size: 14px;
    font-weight: 600;
    font-family: 'D2Coding', 'JetBrains Mono', 'SF Mono', monospace;
    text-transform: uppercase;
  }
  .workspace-icon.active { background: rgba(192, 132, 252, 0.08); color: #c084fc; }

  .workspace-details { flex: 1; min-width: 0; }

  .workspace-name {
    font-size: 13px;
    font-weight: 500;
    color: #e6e6e6;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .workspace-path {
    font-size: 11px;
    color: #666;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: 'D2Coding', 'JetBrains Mono', 'SF Mono', monospace;
  }
</style>
