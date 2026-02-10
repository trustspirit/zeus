<script lang="ts">
  import { tick } from 'svelte'
  import { marked } from 'marked'
  import { claudeSessionStore } from '../stores/claude-session.svelte.js'
  import { uiStore } from '../stores/ui.svelte.js'
  import InputBar from './InputBar.svelte'
  import IconClaude from './icons/IconClaude.svelte'
  import type { ClaudeMessage, ContentBlock } from '../types/index.js'

  let scrollEl: HTMLDivElement
  let inputBarRef = $state<InputBar | undefined>(undefined)
  let isDragOverView = $state(false)

  const conv = $derived(claudeSessionStore.activeConversation)

  // Focus input bar when switching to this view
  $effect(() => {
    if (conv && uiStore.activeView === 'claude') {
      tick().then(() => inputBarRef?.focus())
    }
  })

  // [P2] Auto-scroll with rAF throttle
  let scrollPending = false
  $effect(() => {
    const _ = conv?.messages.length
    const __ = conv?.streamingContent
    void _
    void __
    if (!scrollPending) {
      scrollPending = true
      requestAnimationFrame(() => {
        scrollPending = false
        if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight
      })
    }
  })

  // [P3] Cached markdown rendering
  const mdCache = new Map<string, string>()
  const MD_CACHE_MAX = 100

  function renderMarkdown(text: string): string {
    const cached = mdCache.get(text)
    if (cached) return cached
    try {
      const html = marked.parse(text, { async: false }) as string
      if (mdCache.size >= MD_CACHE_MAX) {
        const firstKey = mdCache.keys().next().value
        if (firstKey !== undefined) mdCache.delete(firstKey)
      }
      mdCache.set(text, html)
      return html
    } catch {
      return `<p>${text}</p>`
    }
  }

  function formatToolName(name: string): string {
    return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  }

  function formatToolInput(input: Record<string, unknown>): string {
    if (input.command) return String(input.command)
    if (input.file_path) return String(input.file_path)
    if (input.query) return String(input.query)
    const keys = Object.keys(input)
    if (keys.length === 0) return ''
    return keys.map((k) => `${k}: ${JSON.stringify(input[k]).slice(0, 60)}`).join(', ')
  }

  function renderBlocks(blocks: ContentBlock[]): string {
    const parts: string[] = []
    for (const block of blocks) {
      switch (block.type) {
        case 'text':
          if (block.text) parts.push(block.text)
          break
        case 'tool_use':
          parts.push(`\n\`\`\`tool\n▶ ${formatToolName(block.name ?? 'Tool')}${block.input ? `  ${formatToolInput(block.input)}` : ''}\n\`\`\`\n`)
          break
        case 'tool_result':
          if (block.content) {
            const content = block.content.length > 500 ? block.content.slice(0, 500) + '…' : block.content
            parts.push(`\n<details><summary>Result</summary>\n\n\`\`\`\n${content}\n\`\`\`\n</details>\n`)
          }
          break
        case 'thinking':
          if (block.thinking) {
            const text = block.thinking.length > 200 ? block.thinking.slice(0, 200) + '…' : block.thinking
            parts.push(`\n<details><summary>Thinking</summary>\n\n${text}\n</details>\n`)
          }
          break
      }
    }
    return parts.join('\n')
  }
</script>

<!-- [B5] Always render; use class:hidden instead of {#if} -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="conversation-view"
  class:hidden={!conv || uiStore.activeView !== 'claude'}
  ondragover={(e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; isDragOverView = true }}
  ondragleave={(e) => { const related = e.relatedTarget as HTMLElement | null; if (!related || !(e.currentTarget as HTMLElement).contains(related)) isDragOverView = false }}
  ondrop={(e) => { e.preventDefault(); isDragOverView = false; inputBarRef?.handleFileDrop(e) }}
>
  {#if isDragOverView}
    <div class="view-drop-overlay">
      <div class="view-drop-box">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        <span>Drop files to attach</span>
      </div>
    </div>
  {/if}
  {#if conv}
    <div class="messages-scroll" bind:this={scrollEl}>
      <div class="messages-container">

        <!-- ── Welcome ── -->
        {#if conv.messages.length === 0 && !conv.isStreaming}
          <div class="welcome">
            <div class="welcome-icon"><IconClaude size={40} /></div>
            <h2>How can I help?</h2>
            <p class="welcome-sub">Ask about your codebase, write code, debug issues, or explore ideas.</p>
          </div>
        {/if}

        <!-- ── Messages ── -->
        {#each conv.messages as message (message.id)}
          <div class="msg" class:user={message.role === 'user'} class:assistant={message.role === 'assistant'}>
            {#if message.role === 'user'}
              <div class="msg-user">
                <div class="msg-user-bubble">{message.content}</div>
              </div>
            {:else}
              <div class="msg-assistant">
                <div class="msg-avatar">
                  <IconClaude size={18} />
                </div>
                <div class="msg-content">
                  {#if message.blocks && message.blocks.length > 0}
                    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                    <div class="md">{@html renderMarkdown(renderBlocks(message.blocks))}</div>
                  {:else}
                    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                    <div class="md">{@html renderMarkdown(message.content)}</div>
                  {/if}
                </div>
              </div>
            {/if}
          </div>
        {/each}

        <!-- ── Streaming ── -->
        {#if conv.isStreaming}
          <div class="msg assistant streaming">
            <div class="msg-assistant">
              <div class="msg-avatar">
                <IconClaude size={18} />
              </div>
              <div class="msg-content">
                {#if conv.streamingBlocks.length > 0}
                  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                  <div class="md">{@html renderMarkdown(renderBlocks(conv.streamingBlocks))}</div>
                {:else if conv.streamingContent}
                  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                  <div class="md">{@html renderMarkdown(conv.streamingContent)}</div>
                {/if}
                <!-- Status line: always visible during streaming -->
                <div class="streaming-status">
                  <span class="status-indicator">
                    <span class="pulse"></span>
                  </span>
                  <span class="status-text">{conv.streamingStatus || 'Thinking…'}</span>
                </div>
              </div>
            </div>
          </div>
        {/if}

        <!-- Bottom spacer for scroll breathing room -->
        <div class="scroll-spacer"></div>
      </div>
    </div>

    <InputBar bind:this={inputBarRef} />
  {/if}
</div>

<style>
  .conversation-view {
    flex: 1; width: 100%; height: 100%;
    display: flex; flex-direction: column;
    background: #282c34; overflow: hidden;
    position: relative;
  }
  .conversation-view.hidden { display: none; }

  .view-drop-overlay {
    position: absolute; inset: 0; z-index: 50;
    display: flex; align-items: center; justify-content: center;
    background: rgba(40, 44, 52, 0.9); pointer-events: none;
  }
  .view-drop-box {
    display: flex; flex-direction: column; align-items: center; gap: 12px;
    padding: 40px 60px; border: 2px dashed #61afef; border-radius: 20px;
    color: #61afef; font-size: 16px; font-weight: 600;
  }

  .messages-scroll { flex: 1; overflow-y: auto; overflow-x: hidden; }
  .messages-scroll::-webkit-scrollbar { width: 5px; }
  .messages-scroll::-webkit-scrollbar-track { background: transparent; }
  .messages-scroll::-webkit-scrollbar-thumb { background: transparent; border-radius: 3px; }
  .messages-scroll:hover::-webkit-scrollbar-thumb { background: #3e4451; }

  .messages-container {
    max-width: 780px; width: 100%;
    margin: 0 auto; padding: 20px 24px 0;
    user-select: text; -webkit-user-select: text;
  }

  .scroll-spacer { height: 24px; }

  /* ────────────────── Welcome ────────────────── */
  .welcome { text-align: center; padding: 72px 24px 40px; }
  .welcome-icon {
    display: inline-flex; align-items: center; justify-content: center;
    width: 64px; height: 64px; border-radius: 20px;
    background: rgba(198, 120, 221, 0.1);
    color: #c678dd; margin-bottom: 20px;
  }
  .welcome h2 {
    font-size: 24px; font-weight: 600; color: #abb2bf;
    margin: 0 0 8px; letter-spacing: -0.02em;
  }
  .welcome-sub { font-size: 14px; color: #5c6370; margin: 0; line-height: 1.5; }

  /* ────────────────── Messages ────────────────── */
  .msg { margin-bottom: 2px; }

  .msg-user { display: flex; justify-content: flex-end; padding: 8px 0; }
  .msg-user-bubble {
    max-width: 85%; padding: 10px 16px; border-radius: 18px 18px 4px 18px;
    background: #2c313a; color: #abb2bf;
    font-size: 14px; line-height: 1.6;
    font-family: 'Pretendard Variable', Pretendard, -apple-system, sans-serif;
    white-space: pre-wrap; word-break: break-word;
    border: 1px solid #3e4451;
  }

  .msg-assistant { display: flex; gap: 12px; padding: 12px 0; }
  .msg-avatar {
    width: 28px; height: 28px; border-radius: 10px;
    display: flex; align-items: center; justify-content: center;
    background: rgba(198, 120, 221, 0.1); color: #c678dd;
    flex-shrink: 0; margin-top: 2px;
  }
  .msg-content { flex: 1; min-width: 0; padding-top: 2px; }

  /* ────────────────── Markdown ────────────────── */
  .md {
    font-size: 14px; line-height: 1.7; color: #abb2bf;
    font-family: 'Pretendard Variable', Pretendard, -apple-system, sans-serif;
  }
  .md :global(h1) { font-size: 20px; font-weight: 700; color: #e5c07b; margin: 20px 0 8px; }
  .md :global(h2) { font-size: 17px; font-weight: 600; color: #e5c07b; margin: 18px 0 6px; }
  .md :global(h3) { font-size: 15px; font-weight: 600; color: #e5c07b; margin: 14px 0 4px; }
  .md :global(p) { margin: 0 0 10px; }
  .md :global(p:last-child) { margin-bottom: 0; }
  .md :global(a) { color: #61afef; text-decoration: none; }
  .md :global(a:hover) { text-decoration: underline; }
  .md :global(strong) { font-weight: 600; color: #d19a66; }
  .md :global(em) { color: #7f848e; }
  .md :global(code) {
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
    background: #21252b; color: #e06c75; padding: 1px 5px; border-radius: 4px;
    font-size: 0.85em; border: 1px solid #3e4451;
  }
  .md :global(pre) {
    background: #1e2127; border: 1px solid #3e4451; border-radius: 10px;
    padding: 14px 16px; overflow-x: auto; margin: 8px 0 12px;
  }
  .md :global(pre code) {
    background: none; padding: 0; color: #abb2bf; font-size: 13px;
    line-height: 1.55; border: none;
  }
  .md :global(blockquote) {
    border-left: 2px solid #4b5263; padding: 6px 14px; margin: 8px 0 12px;
    color: #7f848e;
  }
  .md :global(ul), .md :global(ol) { padding-left: 22px; margin: 4px 0 10px; }
  .md :global(li) { margin: 3px 0; }
  .md :global(li::marker) { color: #5c6370; }
  .md :global(hr) { border: none; border-top: 1px solid #3e4451; margin: 16px 0; }
  .md :global(table) { width: 100%; border-collapse: collapse; margin: 8px 0 12px; font-size: 13px; }
  .md :global(th) { text-align: left; padding: 8px 12px; border-bottom: 1px solid #3e4451; color: #abb2bf; font-weight: 600; }
  .md :global(td) { padding: 6px 12px; border-bottom: 1px solid #2c313a; }
  .md :global(details) {
    margin: 6px 0; padding: 8px 12px; border-radius: 8px;
    background: #1e2127; border: 1px solid #3e4451;
  }
  .md :global(summary) { cursor: pointer; font-weight: 500; color: #5c6370; font-size: 13px; user-select: none; }
  .md :global(summary:hover) { color: #7f848e; }

  /* ────────────────── Streaming status ────────────────── */
  .streaming-status {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 0 4px; font-size: 12px; color: #7f848e;
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
    animation: status-fade-in 200ms ease;
  }
  @keyframes status-fade-in { from { opacity: 0; } to { opacity: 1; } }
  .status-indicator { position: relative; width: 8px; height: 8px; flex-shrink: 0; }
  .pulse {
    display: block; width: 8px; height: 8px; border-radius: 50%;
    background: #c678dd; animation: pulse-ring 1.5s ease-in-out infinite;
  }
  @keyframes pulse-ring {
    0% { opacity: 0.4; transform: scale(0.8); }
    50% { opacity: 1; transform: scale(1.2); }
    100% { opacity: 0.4; transform: scale(0.8); }
  }
  .status-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 500px; }
</style>
