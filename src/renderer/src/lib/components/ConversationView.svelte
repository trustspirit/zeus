<script lang="ts">
  import { tick } from 'svelte'
  import { marked } from 'marked'
  import DOMPurify from 'dompurify'
  import { claudeSessionStore } from '../stores/claude-session.svelte.js'
  import { skillsStore } from '../stores/skills.svelte.js'
  import { uiStore } from '../stores/ui.svelte.js'
  import InputBar from './InputBar.svelte'
  import ChangedFilesPanel from './ChangedFilesPanel.svelte'
  import IconClaude from './icons/IconClaude.svelte'
  import type { ClaudeMessage, ContentBlock } from '../types/index.js'

  let scrollEl: HTMLDivElement
  let inputBarRef = $state<InputBar | undefined>(undefined)
  let changedFilesPanelRef = $state<ChangedFilesPanel | undefined>(undefined)
  let isDragOverView = $state(false)

  const conv = $derived(claudeSessionStore.activeConversation)
  let wasStreaming = $state(false)

  // Focus input bar when switching to this view
  $effect(() => {
    if (conv && uiStore.activeView === 'claude') {
      tick().then(() => inputBarRef?.focus())
    }
  })

  // Auto-refresh changed files when streaming finishes
  $effect(() => {
    const streaming = conv?.isStreaming ?? false
    if (wasStreaming && !streaming) {
      // Streaming just finished — check for file changes
      changedFilesPanelRef?.refresh()
    }
    wasStreaming = streaming
  })

  // Keyboard shortcuts for prompt responses (y/n/a/1-9)
  function handlePromptKeydown(e: KeyboardEvent) {
    const prompt = conv?.pendingPrompt
    if (!prompt || !conv) return
    // Don't intercept if user is typing in input
    const tag = (e.target as HTMLElement)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') return

    const key = e.key.toLowerCase()
    const match = prompt.options.find((o) => o.key === key || o.value === key)
    if (match) {
      e.preventDefault()
      claudeSessionStore.respond(conv.id, match.value)
    }
  }

  $effect(() => {
    if (conv?.pendingPrompt) {
      window.addEventListener('keydown', handlePromptKeydown)
      return () => window.removeEventListener('keydown', handlePromptKeydown)
    }
  })

  // Subagent elapsed time ticker (updates every second)
  let elapsedTick = $state(0)
  let elapsedTimer: ReturnType<typeof setInterval> | null = null
  $effect(() => {
    if (conv?.activeSubagents && conv.activeSubagents.length > 0) {
      if (!elapsedTimer) {
        elapsedTimer = setInterval(() => { elapsedTick++ }, 1000)
      }
    } else {
      if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null }
      elapsedTick = 0
    }
    return () => { if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null } }
  })

  function formatElapsed(startedAt: number): string {
    void elapsedTick // reactive dependency
    const secs = Math.round((Date.now() - startedAt) / 1000)
    if (secs < 60) return `${secs}s`
    const mins = Math.floor(secs / 60)
    const rem = secs % 60
    return `${mins}m ${rem}s`
  }

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

  // [P3] Cached markdown rendering — keyed by lightweight hash instead of full text
  const mdCache = new Map<string, string>()
  const MD_CACHE_MAX = 80

  /** Simple FNV-1a hash for cache key — avoids storing full text as map key */
  function hashStr(s: string): string {
    let h = 0x811c9dc5
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
    return (h >>> 0).toString(36) + '_' + s.length
  }

  function renderMarkdown(text: string): string {
    const key = hashStr(text)
    const cached = mdCache.get(key)
    if (cached) return cached
    try {
      const raw = marked.parse(text, { async: false }) as string
      const html = DOMPurify.sanitize(raw, { ADD_TAGS: ['details', 'summary'], ADD_ATTR: ['style'] })
      if (mdCache.size >= MD_CACHE_MAX) {
        const firstKey = mdCache.keys().next().value
        if (firstKey !== undefined) mdCache.delete(firstKey)
      }
      mdCache.set(key, html)
      return html
    } catch {
      return `<p>${DOMPurify.sanitize(text)}</p>`
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

  /** Check if a tool name is a subagent */
  function isSubagent(name: string): boolean {
    return name === 'Task' || name.startsWith('dispatch_agent') || name === 'Agents'
  }

  /** Named color keywords → hex (matches Claude Code's agent color palette) */
  const AGENT_COLOR_MAP: Record<string, string> = {
    blue: '#61afef', purple: '#c678dd', green: '#98c379', yellow: '#e5c07b',
    cyan: '#56b6c2', orange: '#d19a66', red: '#e06c75', pink: '#e06c95',
    magenta: '#c678dd', teal: '#56b6c2', lime: '#a9dc76', indigo: '#7c8cf5',
    brown: '#be5046', white: '#abb2bf', gray: '#7f848e', grey: '#7f848e',
  }
  const SA_COLORS = [...new Set(Object.values(AGENT_COLOR_MAP))]

  /** Look up an agent's color from customSkills frontmatter, then hash fallback */
  function saColor(agentName: string): string {
    const normalized = agentName.toLowerCase().replace(/-/g, '_')
    for (const skill of skillsStore.customSkills) {
      if (skill.kind !== 'agent') continue
      const skillNorm = skill.name.toLowerCase().replace(/-/g, '_')
      if (skillNorm === normalized || skillNorm.endsWith(normalized) || normalized.endsWith(skillNorm)) {
        if (skill.color) return AGENT_COLOR_MAP[skill.color.toLowerCase()] ?? skill.color
      }
    }
    // Hash fallback
    let h = 0
    for (let i = 0; i < agentName.length; i++) h = ((h << 5) - h + agentName.charCodeAt(i)) | 0
    return SA_COLORS[Math.abs(h) % SA_COLORS.length]
  }
  /** Derive readable agent name from tool name + input */
  function deriveAgentName(toolName: string, input?: Record<string, unknown>): string {
    if (toolName.startsWith('dispatch_agent_')) return toolName.slice('dispatch_agent_'.length).replace(/_/g, '-')
    if (input) {
      if (typeof input.agent_name === 'string' && input.agent_name) return input.agent_name.replace(/_/g, '-')
      if (typeof input.name === 'string' && input.name) return input.name.replace(/_/g, '-')
    }
    const desc = (input?.description || input?.prompt || '') as string
    if (desc) {
      const m = desc.match(/^([a-z][a-z0-9_-]{2,30})(?:\s|:|$)/i)
      if (m) return m[1].toLowerCase().replace(/_/g, '-')
      const words = desc.split(/\s+/).slice(0, 3).join(' ')
      return words.length > 30 ? words.slice(0, 30) + '…' : words
    }
    return 'Subagent'
  }

  function renderBlocks(blocks: ContentBlock[]): string {
    const parts: string[] = []
    let inSubagent = false
    for (const block of blocks) {
      switch (block.type) {
        case 'text':
          if (block.text) {
            if (inSubagent) {
              parts.push(`> ${block.text.split('\n').join('\n> ')}`)
              inSubagent = false
            } else {
              parts.push(block.text)
            }
          }
          break
        case 'tool_use': {
          const name = block.name ?? 'Tool'
          if (isSubagent(name)) {
            const agentName = deriveAgentName(name, block.input)
            const color = saColor(agentName)
            const desc = block.input?.description || block.input?.prompt
            const descText = typeof desc === 'string'
              ? (desc.length > 120 ? desc.slice(0, 120) + '…' : desc)
              : ''
            parts.push(`\n---\n<span style="color:${color}">**⦿ ${agentName}**</span> ${descText ? `— ${descText}` : ''}\n`)
            inSubagent = true
          } else {
            const prefix = inSubagent ? '> ' : ''
            parts.push(`\n${prefix}\`\`\`tool\n${prefix}▶ ${formatToolName(name)}${block.input ? `  ${formatToolInput(block.input)}` : ''}\n${prefix}\`\`\`\n`)
          }
          break
        }
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

        <!-- ── Quick replies: shown after the last assistant message asks a numbered question ── -->
        {#if !conv.isStreaming && conv.quickReplies && conv.quickReplies.length > 0}
          <div class="quick-replies">
            <div class="quick-replies-label">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              Choose an option
            </div>
            <div class="quick-replies-grid">
              {#each conv.quickReplies as reply (reply.value)}
                <button
                  class="quick-reply-btn"
                  onclick={() => claudeSessionStore.send(conv.id, reply.value)}
                >
                  <span class="quick-reply-num">{reply.value}</span>
                  <span class="quick-reply-label">{reply.label}</span>
                </button>
              {/each}
            </div>
          </div>
        {/if}

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
                <!-- Prompt UI: shown when Claude Code asks for permission/options -->
                {#if conv.pendingPrompt}
                  <div class="prompt-ui">
                    <div class="prompt-header">
                      {#if conv.pendingPrompt.promptType === 'permission'}
                        <svg class="prompt-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                      {:else if conv.pendingPrompt.promptType === 'choice'}
                        <svg class="prompt-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/></svg>
                      {:else}
                        <svg class="prompt-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                      {/if}
                      <span class="prompt-message">{conv.pendingPrompt.message}</span>
                    </div>
                    {#if conv.pendingPrompt.toolName}
                      <div class="prompt-tool">
                        <code>{conv.pendingPrompt.toolName}</code>
                        {#if conv.pendingPrompt.toolInput}
                          <span class="prompt-tool-input">{conv.pendingPrompt.toolInput.length > 120 ? conv.pendingPrompt.toolInput.slice(0, 120) + '…' : conv.pendingPrompt.toolInput}</span>
                        {/if}
                      </div>
                    {/if}
                    <!-- Quick-select buttons (shown when options are available) -->
                    {#if conv.pendingPrompt.options.length > 0}
                      <div class="prompt-actions">
                        {#each conv.pendingPrompt.options as opt (opt.value)}
                          <button
                            class="prompt-btn"
                            class:prompt-yes={opt.value === 'y'}
                            class:prompt-no={opt.value === 'n'}
                            class:prompt-always={opt.value === 'a'}
                            onclick={() => claudeSessionStore.respond(conv.id, opt.value)}
                            title={opt.key ? `Press ${opt.key}` : ''}
                          >
                            {#if opt.value === 'y'}
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
                            {:else if opt.value === 'n'}
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            {:else if opt.value === 'a'}
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                            {/if}
                            {opt.label}
                            {#if opt.key}
                              <kbd class="prompt-kbd">{opt.key}</kbd>
                            {/if}
                          </button>
                        {/each}
                      </div>
                    {/if}
                    <!-- Free text input — always shown so the user can type a custom response -->
                    <form class="prompt-input-form" onsubmit={(e) => {
                      e.preventDefault()
                      const form = e.currentTarget as HTMLFormElement
                      const input = form.querySelector('input') as HTMLInputElement
                      if (input.value.trim()) {
                        claudeSessionStore.respond(conv.id, input.value.trim())
                        input.value = ''
                      }
                    }}>
                      <input
                        class="prompt-text-input"
                        type="text"
                        placeholder={conv.pendingPrompt.options.length > 0 ? 'Or type a custom response…' : 'Type your response…'}
                        autofocus
                      />
                      <button class="prompt-btn prompt-yes" type="submit">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
                        Send
                      </button>
                    </form>
                  </div>
                {:else if conv.activeSubagents && conv.activeSubagents.length > 0}
                  <!-- Subagent panels: supports parallel agent teams -->
                  {#if conv.activeSubagents.length > 1}
                    <div class="subagent-team-header">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                      <span>{conv.activeSubagents.length} agents running in parallel</span>
                    </div>
                  {/if}
                  <div class="subagent-grid" class:parallel={conv.activeSubagents.length > 1}>
                    {#each conv.activeSubagents.filter(s => !s.finished) as sa (sa.id)}
                      <div class="subagent-panel" style="border-color: {sa.color}33; background: linear-gradient(135deg, {sa.color}0a, {sa.color}06);">
                        <div class="subagent-header">
                          <span class="subagent-dot" style="background: {sa.color};"></span>
                          <span class="subagent-name" style="color: {sa.color};">{sa.name}</span>
                          <span class="subagent-elapsed">{formatElapsed(sa.startedAt)}</span>
                        </div>
                        <div class="subagent-desc">{sa.description}</div>
                        <div class="subagent-activity">
                          <span class="subagent-pulse" style="background: {sa.color};"></span>
                          <span class="subagent-status">{sa.nestedStatus || 'Working…'}</span>
                        </div>
                        {#if sa.toolsUsed.length > 0}
                          <div class="subagent-tools">
                            {#each sa.toolsUsed as tool (tool)}
                              <span class="subagent-tool-chip" style="border-color: {sa.color}26; background: {sa.color}0d;">{tool}</span>
                            {/each}
                          </div>
                        {/if}
                      </div>
                    {/each}
                  </div>
                {:else}
                  <!-- Status line: always visible during streaming -->
                  <div class="streaming-status">
                    <span class="status-indicator">
                      <span class="pulse"></span>
                    </span>
                    <span class="status-text">{conv.streamingStatus || 'Thinking…'}</span>
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

    <ChangedFilesPanel bind:this={changedFilesPanelRef} />
    <InputBar bind:this={inputBarRef} ontoggleChanges={() => changedFilesPanelRef?.toggle()} />
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

  /* ── Subagent Panel ──────────────────────────────────────────────────── */
  .subagent-team-header {
    display: flex; align-items: center; gap: 6px;
    margin-top: 10px; margin-bottom: 2px;
    font-size: 11px; color: #7f848e;
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
    font-weight: 500; letter-spacing: 0.02em;
  }
  .subagent-team-header svg { opacity: 0.6; }
  .subagent-grid {
    display: flex; flex-direction: column; gap: 6px;
  }
  .subagent-grid.parallel {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 8px;
  }
  .subagent-panel {
    display: flex; flex-direction: column; gap: 6px;
    padding: 10px 12px; margin-top: 4px;
    border: 1px solid; border-radius: 10px;
    animation: status-fade-in 200ms ease;
    min-width: 0;
  }
  .subagent-grid.parallel .subagent-panel {
    margin-top: 0;
  }
  .subagent-header {
    display: flex; align-items: center; gap: 8px;
    font-size: 12px; font-weight: 600;
  }
  .subagent-dot {
    width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
    animation: pulse-ring 1.5s ease-in-out infinite;
  }
  .subagent-name {
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
    font-size: 13px; font-weight: 700; letter-spacing: -0.01em;
  }
  .subagent-elapsed {
    margin-left: auto; font-size: 10px; color: #5c6370;
    font-family: 'D2Coding', 'JetBrains Mono', monospace; font-weight: 400;
  }
  .subagent-desc {
    font-size: 12px; color: #abb2bf; line-height: 1.5;
    max-height: 60px; overflow: hidden; text-overflow: ellipsis;
  }
  .subagent-activity {
    display: flex; align-items: center; gap: 6px;
    font-size: 11px; color: #7f848e;
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
  }
  .subagent-pulse {
    width: 6px; height: 6px; border-radius: 50%;
    flex-shrink: 0;
    animation: pulse-ring 1.5s ease-in-out infinite;
  }
  .subagent-status {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .subagent-tools {
    display: flex; gap: 4px; flex-wrap: wrap; margin-top: 2px;
  }
  .subagent-tool-chip {
    display: inline-block; padding: 1px 6px;
    border: 1px solid; border-radius: 4px;
    font-size: 10px; color: #7f848e;
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
  }

  /* ── Prompt UI ─────────────────────────────────────────────────────────── */
  .prompt-ui {
    display: flex; flex-direction: column; gap: 8px;
    padding: 12px 14px; margin-top: 8px;
    background: #2c2d31; border: 1px solid #3e4045; border-radius: 10px;
    animation: status-fade-in 200ms ease;
  }
  .prompt-header {
    display: flex; align-items: flex-start; gap: 8px;
    font-size: 13px; color: #e0e0e0; line-height: 1.5;
  }
  .prompt-icon { flex-shrink: 0; color: #e5c07b; margin-top: 2px; }
  .prompt-message {
    white-space: pre-wrap; word-break: break-word;
    max-height: 200px; overflow-y: auto;
  }
  .prompt-tool {
    display: flex; align-items: center; gap: 6px;
    padding: 6px 10px; background: #1e1f23; border-radius: 6px;
    font-size: 12px; color: #abb2bf; overflow: hidden;
  }
  .prompt-tool code {
    color: #c678dd; font-family: 'D2Coding', 'JetBrains Mono', monospace;
    font-size: 12px; background: none; padding: 0;
  }
  .prompt-tool-input {
    color: #7f848e; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .prompt-actions {
    display: flex; gap: 8px; flex-wrap: wrap; margin-top: 2px;
  }
  .prompt-btn {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 6px 14px; border: 1px solid #3e4045; border-radius: 6px;
    background: #2c2d31; color: #abb2bf; font-size: 12px;
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
    cursor: pointer; transition: all 120ms ease;
  }
  .prompt-btn:hover { background: #363840; border-color: #5a5d65; color: #e0e0e0; }
  .prompt-btn.prompt-yes {
    border-color: rgba(152, 195, 121, 0.4); color: #98c379;
  }
  .prompt-btn.prompt-yes:hover {
    background: rgba(152, 195, 121, 0.12); border-color: #98c379;
  }
  .prompt-btn.prompt-no {
    border-color: rgba(224, 108, 117, 0.4); color: #e06c75;
  }
  .prompt-btn.prompt-no:hover {
    background: rgba(224, 108, 117, 0.12); border-color: #e06c75;
  }
  .prompt-btn.prompt-always {
    border-color: rgba(229, 192, 123, 0.4); color: #e5c07b;
  }
  .prompt-btn.prompt-always:hover {
    background: rgba(229, 192, 123, 0.12); border-color: #e5c07b;
  }
  .prompt-input-form {
    display: flex; gap: 8px; width: 100%;
  }
  .prompt-text-input {
    flex: 1; padding: 6px 10px;
    background: #1e1f23; border: 1px solid #3e4045; border-radius: 6px;
    color: #e0e0e0; font-size: 12px;
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
    outline: none;
  }
  .prompt-text-input:focus { border-color: #5a5d65; }
  .prompt-kbd {
    display: inline-block; padding: 1px 5px; margin-left: 2px;
    background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 3px; font-size: 10px; color: #7f848e;
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
    line-height: 1.4; vertical-align: middle;
  }

  /* ── Quick Replies ──────────────────────────────────────────────────── */
  .quick-replies {
    display: flex; flex-direction: column; gap: 8px;
    padding: 12px 0; margin-left: 40px;
    animation: status-fade-in 200ms ease;
  }
  .quick-replies-label {
    display: flex; align-items: center; gap: 6px;
    font-size: 11px; font-weight: 600; color: #5c6370;
    text-transform: uppercase; letter-spacing: 0.04em;
  }
  .quick-replies-grid {
    display: flex; flex-direction: column; gap: 4px;
  }
  .quick-reply-btn {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 14px; border: 1px solid #3e4451; border-radius: 8px;
    background: #2c313a; color: #abb2bf; font-size: 13px;
    font-family: 'Pretendard Variable', Pretendard, -apple-system, sans-serif;
    cursor: pointer; transition: all 120ms ease; text-align: left;
    line-height: 1.4;
  }
  .quick-reply-btn:hover {
    background: #363c48; border-color: #61afef; color: #e0e0e0;
  }
  .quick-reply-btn:active {
    background: rgba(97, 175, 239, 0.12);
  }
  .quick-reply-num {
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 22px; height: 22px; border-radius: 6px;
    background: rgba(97, 175, 239, 0.12); color: #61afef;
    font-size: 12px; font-weight: 600; flex-shrink: 0;
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
  }
  .quick-reply-label {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
</style>
