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
<div class="conversation-view" class:hidden={!conv || uiStore.activeView !== 'claude'}>
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

          <!-- Saved sessions -->
          {#if claudeSessionStore.savedSessions.length > 0}
            <div class="session-history">
              <span class="history-label">Recent</span>
              <div class="history-list">
                {#each claudeSessionStore.savedSessions as saved (saved.sessionId)}
                  <div class="history-item">
                    <button class="history-resume" onclick={() => claudeSessionStore.resume(saved)}>
                      <span class="history-title">{saved.title}</span>
                      <span class="history-time">
                        {new Date(saved.lastUsed).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                      </span>
                    </button>
                    <button
                      class="history-delete"
                      title="Delete"
                      onclick={() => claudeSessionStore.deleteSaved(saved.sessionId)}
                    >&times;</button>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
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
                {#if conv.streamingContent}
                  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                  <div class="md">{@html renderMarkdown(
                    conv.streamingBlocks.length > 0
                      ? renderBlocks(conv.streamingBlocks)
                      : conv.streamingContent
                  )}</div>
                {:else}
                  <div class="thinking">
                    <span class="dot"></span><span class="dot"></span><span class="dot"></span>
                  </div>
                {/if}
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
    background: #0d0d0d; overflow: hidden;
  }
  .conversation-view.hidden { display: none; }

  .messages-scroll {
    flex: 1; overflow-y: auto; overflow-x: hidden;
  }
  .messages-scroll::-webkit-scrollbar { width: 5px; }
  .messages-scroll::-webkit-scrollbar-track { background: transparent; }
  .messages-scroll::-webkit-scrollbar-thumb { background: transparent; border-radius: 3px; }
  .messages-scroll:hover::-webkit-scrollbar-thumb { background: #313244; }

  .messages-container {
    max-width: 780px; width: 100%;
    margin: 0 auto; padding: 20px 24px 0;
    user-select: text;
    -webkit-user-select: text;
  }

  .scroll-spacer { height: 24px; }

  /* ────────────────── Welcome ────────────────── */
  .welcome {
    text-align: center; padding: 72px 24px 40px;
  }
  .welcome-icon {
    display: inline-flex; align-items: center; justify-content: center;
    width: 64px; height: 64px; border-radius: 20px;
    background: rgba(203, 166, 247, 0.08);
    color: #cba6f7; margin-bottom: 20px;
  }
  .welcome h2 {
    font-size: 24px; font-weight: 600; color: #cdd6f4;
    margin: 0 0 8px; letter-spacing: -0.02em;
  }
  .welcome-sub {
    font-size: 14px; color: #585b70; margin: 0;
    line-height: 1.5;
  }

  /* ────────────────── Session History ────────────────── */
  .session-history {
    max-width: 420px; margin: 0 auto; padding: 0 0 40px;
  }
  .history-label {
    font-size: 11px; font-weight: 600; color: #45475a;
    text-transform: uppercase; letter-spacing: 0.06em;
    display: block; margin-bottom: 8px; padding-left: 2px;
  }
  .history-list {
    display: flex; flex-direction: column; gap: 2px;
  }
  .history-item {
    display: flex; align-items: center; gap: 2px;
    border-radius: 8px;
  }
  .history-resume {
    flex: 1; min-width: 0;
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 8px 12px; border-radius: 8px;
    border: none; background: transparent;
    color: #a6adc8; cursor: pointer;
    transition: background 100ms ease;
    text-align: left; font-family: inherit;
  }
  .history-resume:hover { background: #181825; color: #cdd6f4; }
  .history-title {
    font-size: 13px; font-weight: 500;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    min-width: 0;
  }
  .history-time {
    font-size: 11px; color: #45475a;
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
    white-space: nowrap; flex-shrink: 0;
  }
  .history-delete {
    width: 24px; height: 24px; border: none; border-radius: 6px;
    background: transparent; color: #313244; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0; font-size: 16px; line-height: 1;
    transition: all 100ms ease;
  }
  .history-delete:hover { color: #f38ba8; background: rgba(243, 139, 168, 0.08); }

  /* ────────────────── Messages ────────────────── */
  .msg { margin-bottom: 2px; }

  /* ── User ── */
  .msg-user {
    display: flex; justify-content: flex-end;
    padding: 8px 0;
  }
  .msg-user-bubble {
    max-width: 85%;
    padding: 10px 16px; border-radius: 18px 18px 4px 18px;
    background: #1e1e2e; color: #cdd6f4;
    font-size: 14px; line-height: 1.6;
    font-family: 'Pretendard Variable', Pretendard, -apple-system, sans-serif;
    white-space: pre-wrap; word-break: break-word;
    border: 1px solid #313244;
  }

  /* ── Assistant ── */
  .msg-assistant {
    display: flex; gap: 12px;
    padding: 12px 0;
  }
  .msg-avatar {
    width: 28px; height: 28px; border-radius: 10px;
    display: flex; align-items: center; justify-content: center;
    background: rgba(203, 166, 247, 0.08); color: #cba6f7;
    flex-shrink: 0; margin-top: 2px;
  }
  .msg-content {
    flex: 1; min-width: 0;
    padding-top: 2px;
  }

  /* ────────────────── Markdown ────────────────── */
  .md {
    font-size: 14px; line-height: 1.7; color: #cdd6f4;
    font-family: 'Pretendard Variable', Pretendard, -apple-system, sans-serif;
  }
  .md :global(h1) { font-size: 20px; font-weight: 700; color: #cdd6f4; margin: 20px 0 8px; }
  .md :global(h2) { font-size: 17px; font-weight: 600; color: #cdd6f4; margin: 18px 0 6px; }
  .md :global(h3) { font-size: 15px; font-weight: 600; color: #cdd6f4; margin: 14px 0 4px; }
  .md :global(p) { margin: 0 0 10px; }
  .md :global(p:last-child) { margin-bottom: 0; }
  .md :global(a) { color: #89b4fa; text-decoration: none; }
  .md :global(a:hover) { text-decoration: underline; }
  .md :global(strong) { font-weight: 600; color: #cdd6f4; }
  .md :global(em) { color: #a6adc8; }
  .md :global(code) {
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
    background: #181825; color: #f38ba8; padding: 1px 5px; border-radius: 4px;
    font-size: 0.85em; border: 1px solid #1e1e2e;
  }
  .md :global(pre) {
    background: #11111b; border: 1px solid #1e1e2e; border-radius: 10px;
    padding: 14px 16px; overflow-x: auto; margin: 8px 0 12px;
  }
  .md :global(pre code) {
    background: none; padding: 0; color: #cdd6f4; font-size: 13px;
    line-height: 1.55; border: none;
  }
  .md :global(blockquote) {
    border-left: 2px solid #45475a; padding: 6px 14px; margin: 8px 0 12px;
    color: #a6adc8;
  }
  .md :global(ul), .md :global(ol) {
    padding-left: 22px; margin: 4px 0 10px;
  }
  .md :global(li) { margin: 3px 0; }
  .md :global(li::marker) { color: #585b70; }
  .md :global(hr) {
    border: none; border-top: 1px solid #1e1e2e; margin: 16px 0;
  }
  .md :global(table) { width: 100%; border-collapse: collapse; margin: 8px 0 12px; font-size: 13px; }
  .md :global(th) { text-align: left; padding: 8px 12px; border-bottom: 1px solid #313244; color: #cdd6f4; font-weight: 600; }
  .md :global(td) { padding: 6px 12px; border-bottom: 1px solid #181825; }
  .md :global(details) {
    margin: 6px 0; padding: 8px 12px; border-radius: 8px;
    background: #11111b; border: 1px solid #1e1e2e;
  }
  .md :global(summary) {
    cursor: pointer; font-weight: 500; color: #7f849c; font-size: 13px;
    user-select: none;
  }
  .md :global(summary:hover) { color: #a6adc8; }

  /* ────────────────── Thinking dots ────────────────── */
  .thinking {
    display: flex; gap: 5px; padding: 8px 0;
  }
  .dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: #cba6f7; opacity: 0.25;
    animation: dot-pulse 1.4s ease-in-out infinite;
  }
  .dot:nth-child(2) { animation-delay: 0.16s; }
  .dot:nth-child(3) { animation-delay: 0.32s; }

  @keyframes dot-pulse {
    0%, 80%, 100% { opacity: 0.25; transform: scale(1); }
    40% { opacity: 0.8; transform: scale(1.3); }
  }
</style>
