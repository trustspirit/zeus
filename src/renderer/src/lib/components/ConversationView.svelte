<script lang="ts">
  import { tick } from 'svelte'
  import { marked } from 'marked'
  import DOMPurify from 'dompurify'
  import { claudeSessionStore } from '../stores/claude-session.svelte.js'
  import { skillsStore } from '../stores/skills.svelte.js'
  import { uiStore } from '../stores/ui.svelte.js'
  import { isSubagentTool, isSubagentAuxTool, subagentAuxLabel, extractSubagentName, resolveAgentColor } from '../utils/agent-colors.js'
  import InputBar from './InputBar.svelte'
  import ChangedFilesPanel from './ChangedFilesPanel.svelte'
  import IconClaude from './icons/IconClaude.svelte'
  import type { ClaudeMessage, ContentBlock } from '../types/index.js'

  let scrollEl = $state<HTMLDivElement>(undefined!)
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
      claudeSessionStore.respond(conv.id, match.value, match.label)
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
      const html = DOMPurify.sanitize(raw, { ADD_TAGS: ['details', 'summary'], ADD_ATTR: ['style', 'class'] })
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

  /** Human-readable tool labels — matches Claude Code CLI style */
  const TOOL_DISPLAY: Record<string, string> = {
    read: 'Read', write: 'Write', edit: 'Edit', multiedit: 'Multi-Edit',
    bash: 'Bash', glob: 'Glob', grep: 'Grep', ls: 'List',
    browser: 'Browser', notebookedit: 'Notebook Edit',
    todoread: 'Todo Read', todowrite: 'Todo Write',
    webfetch: 'Web Fetch', search: 'Search'
  }

  function formatToolName(name: string): string {
    return TOOL_DISPLAY[name.toLowerCase()] || name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  }

  /** Format tool invocation in CLI-like compact style */
  function formatToolCompact(name: string, input: Record<string, unknown>): string {
    const lower = name.toLowerCase()
    // Read/Write/Edit — show file path
    if ((lower === 'read' || lower === 'write' || lower === 'edit' || lower === 'multiedit') && input.file_path) {
      return `${formatToolName(name)} \`${input.file_path}\``
    }
    // Bash — show command
    if (lower === 'bash' && input.command) {
      const cmd = String(input.command)
      return `Bash \`${cmd.length > 80 ? cmd.slice(0, 80) + '…' : cmd}\``
    }
    // Grep — show pattern + optional path
    if (lower === 'grep' && input.pattern) {
      const target = input.file_path || input.path || ''
      return `Grep \`${input.pattern}\`${target ? ` in ${target}` : ''}`
    }
    // Glob — show pattern
    if (lower === 'glob' && input.pattern) {
      return `Glob \`${input.pattern}\``
    }
    // LS — show path
    if (lower === 'ls' && input.path) {
      return `List \`${input.path}\``
    }
    // Search — show query
    if ((lower === 'search' || lower === 'webfetch') && input.query) {
      return `${formatToolName(name)} "${String(input.query).slice(0, 60)}"`
    }
    // Generic fallback
    const detail = input.file_path || input.command || input.query || input.pattern || input.path
    if (detail) return `${formatToolName(name)} \`${String(detail).slice(0, 80)}\``
    return formatToolName(name)
  }

  /** Summarize a tool result content into a compact one-liner */
  function summarizeToolResult(content: string, prevToolName?: string): string {
    const lines = content.trim().split('\n').filter(l => l.trim())
    // For file reads — show line count
    if (prevToolName?.toLowerCase() === 'read' && lines.length > 0) {
      return `Loaded (${lines.length} lines)`
    }
    // For grep — count matches
    if (prevToolName?.toLowerCase() === 'grep') {
      const matchCount = lines.length
      return matchCount > 0 ? `${matchCount} match${matchCount !== 1 ? 'es' : ''}` : 'No matches'
    }
    // For glob — count files
    if (prevToolName?.toLowerCase() === 'glob') {
      return `${lines.length} file${lines.length !== 1 ? 's' : ''} found`
    }
    // For bash — show first line of output
    if (prevToolName?.toLowerCase() === 'bash' && lines.length > 0) {
      const first = lines[0].slice(0, 100)
      return lines.length > 1 ? `${first} (+${lines.length - 1} lines)` : first
    }
    // Generic: first line
    if (lines.length > 0) {
      return lines[0].slice(0, 100) + (lines.length > 1 ? ` (+${lines.length - 1} lines)` : '')
    }
    return 'Done'
  }

  /** Format token count compactly: 1234 → "1.2k", 12345 → "12.3k" */
  function fmtTokens(n: number): string {
    if (n < 1000) return String(n)
    if (n < 10000) return (n / 1000).toFixed(1) + 'k'
    return Math.round(n / 1000) + 'k'
  }

  /** Format USD cost: 0.037548 → "$0.04" */
  function fmtCost(usd: number): string {
    if (usd < 0.01) return '<$0.01'
    if (usd < 1) return '$' + usd.toFixed(2)
    return '$' + usd.toFixed(2)
  }

  /** Get agent color using shared utility with current skills data */
  function saColor(agentName: string): string {
    return resolveAgentColor(agentName, skillsStore.customSkills)
  }

  function renderBlocks(blocks: ContentBlock[]): string {
    const parts: string[] = []
    let inSubagent = false
    let lastToolName: string | undefined = undefined

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i]
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
          lastToolName = undefined
          break
        case 'tool_use': {
          const name = block.name ?? 'Tool'
          if (isSubagentTool(name)) {
            const agentName = extractSubagentName(name, block.input ?? {}) || name
            const color = saColor(agentName)
            const desc = block.input?.description || block.input?.prompt
            const descText = typeof desc === 'string'
              ? (desc.length > 120 ? desc.slice(0, 120) + '…' : desc)
              : ''
            parts.push(`\n<span class="tool-agent" style="color:${color}">⦿ **${agentName}**${descText ? `<span class="tool-desc"> — ${descText}</span>` : ''}</span>\n`)
            inSubagent = true
          } else if (isSubagentAuxTool(name)) {
            // Try to resolve agent name from task_id by scanning earlier blocks
            const taskId = typeof block.input?.task_id === 'string' ? block.input.task_id : ''
            let resolvedAgents: { taskId?: string; name: string }[] | undefined
            if (taskId) {
              // Build a mini-map of subagents from earlier Task tool_use blocks
              const agentsFromBlocks: { taskId?: string; name: string }[] = []
              for (let j = 0; j < i; j++) {
                const pb = blocks[j]
                if (pb.type === 'tool_use' && pb.name && isSubagentTool(pb.name) && pb.input) {
                  const aName = extractSubagentName(pb.name, pb.input) || pb.name
                  // Check if the next block is a tool_result with the task_id
                  let tid: string | undefined
                  if (j + 1 < i && blocks[j + 1].type === 'tool_result') {
                    const tidMatch = (blocks[j + 1].content ?? '').match(/task[_-]?id["\s:]+["']?([a-f0-9]{6,12})/i)
                    if (tidMatch) tid = tidMatch[1]
                  }
                  agentsFromBlocks.push({ taskId: tid, name: aName })
                }
              }
              if (agentsFromBlocks.length > 0) resolvedAgents = agentsFromBlocks
            }
            const label = subagentAuxLabel(name, block.input ?? {}, resolvedAgents)
            parts.push(`\n<span class="tool-wait">⏳ ${label}</span>\n`)
          } else {
            // CLI-like compact tool display with icon
            const prefix = inSubagent ? '> ' : ''
            const compact = formatToolCompact(name, block.input ?? {})
            parts.push(`\n${prefix}<span class="tool-line">⏺ ${compact}</span>\n`)
          }
          lastToolName = name
          break
        }
        case 'tool_result':
          if (block.content) {
            const summary = summarizeToolResult(block.content, lastToolName)
            const content = block.content.length > 500 ? block.content.slice(0, 500) + '…' : block.content
            const prefix = inSubagent ? '> ' : ''
            parts.push(`${prefix}<details><summary class="tool-result-summary">  ⎿ ${summary}</summary>\n\n\`\`\`\n${content}\n\`\`\`\n</details>\n`)
          }
          lastToolName = undefined
          break
        case 'thinking':
          if (block.thinking) {
            const text = block.thinking.length > 200 ? block.thinking.slice(0, 200) + '…' : block.thinking
            parts.push(`\n<details><summary>Thinking</summary>\n\n${text}\n</details>\n`)
          }
          lastToolName = undefined
          break
      }
    }
    return parts.join('\n')
  }

  /**
   * Get any trailing text content that was received via text_delta AFTER
   * the last block's text. Since we now build blocks incrementally,
   * this is typically empty — but serves as a safety net.
   */
  function getTrailingContent(blocks: ContentBlock[], fullText: string): string {
    if (!blocks.length || !fullText) return ''
    // Compute total text in blocks
    let blockTextLen = 0
    for (const b of blocks) {
      if (b.type === 'text' && b.text) blockTextLen += b.text.length
    }
    // If streamingContent has more text than what's in blocks, return the extra
    if (fullText.length > blockTextLen) {
      return fullText.slice(blockTextLen)
    }
    return ''
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
  <!-- Streaming progress bar -->
  {#if conv?.isStreaming}
    <div class="stream-progress"><div class="stream-progress-bar"></div></div>
  {/if}

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
                <div class="msg-user-bubble">
                  {#if !message.displayContent && message.content.length > 500}
                    <span class="msg-skill-badge">skill</span>
                    {message.content.slice(0, 120).trim()}…
                  {:else}
                    {message.displayContent || message.content}
                  {/if}
                </div>
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
                  {@const trailing = getTrailingContent(conv.streamingBlocks, conv.streamingContent)}
                  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                  <div class="md">{@html renderMarkdown(renderBlocks(conv.streamingBlocks) + (trailing ? '\n' + trailing : ''))}</div>
                {:else if conv.streamingContent}
                  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                  <div class="md">{@html renderMarkdown(conv.streamingContent)}</div>
                {/if}
                {#if conv.activeSubagents && conv.activeSubagents.length > 0}
                  <!-- Subagent table: compact status view -->
                  {@const activeAgents = conv.activeSubagents.filter(s => !s.finished)}
                  <div class="sa-table">
                    <div class="sa-table-header">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                      <span>{activeAgents.length} agent{activeAgents.length !== 1 ? 's' : ''} running</span>
                    </div>
                    <div class="sa-table-body">
                      <div class="sa-row sa-row-head">
                        <span class="sa-cell sa-c-name">Agent</span>
                        <span class="sa-cell sa-c-status">Status</span>
                        <span class="sa-cell sa-c-tools">Tools</span>
                        <span class="sa-cell sa-c-time">Time</span>
                      </div>
                      {#each activeAgents as sa (sa.id)}
                        <div class="sa-row" style="--sa-color: {sa.color};">
                          <span class="sa-cell sa-c-name">
                            <span class="sa-dot"></span>
                            <span class="sa-name">{sa.name}</span>
                            {#if sa.background}<span class="sa-bg-badge">BG</span>{/if}
                          </span>
                          <span class="sa-cell sa-c-status">
                            <span class="sa-status-text">{sa.nestedStatus || sa.description || 'Working…'}</span>
                          </span>
                          <span class="sa-cell sa-c-tools">
                            {#if sa.toolsUsed.length > 0}
                              <span class="sa-tool-list">{sa.toolsUsed.slice(-3).join(', ')}{sa.toolsUsed.length > 3 ? ` +${sa.toolsUsed.length - 3}` : ''}</span>
                            {:else}
                              <span class="sa-tool-list sa-muted">—</span>
                            {/if}
                          </span>
                          <span class="sa-cell sa-c-time">{formatElapsed(sa.startedAt)}</span>
                        </div>
                      {/each}
                    </div>
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
                <!-- Token usage: shown during streaming when data is available -->
                {#if conv.tokenUsage}
                  <div class="token-usage">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/></svg>
                    <span class="token-in" title="Input tokens">↓{fmtTokens(conv.tokenUsage.inputTokens)}</span>
                    <span class="token-out" title="Output tokens">↑{fmtTokens(conv.tokenUsage.outputTokens)}</span>
                    {#if conv.tokenUsage.cacheReadTokens > 0}
                      <span class="token-cache" title="Cache read tokens">⚡{fmtTokens(conv.tokenUsage.cacheReadTokens)}</span>
                    {/if}
                    {#if conv.tokenUsage.totalCostUsd > 0}
                      <span class="token-cost" title="Estimated cost">{fmtCost(conv.tokenUsage.totalCostUsd)}</span>
                    {/if}
                  </div>
                {/if}
              </div>
            </div>
          </div>
        {/if}

        <!-- ── Prompt UI: shown when Claude Code asks for permission/options ── -->
        <!-- Lives OUTSIDE the streaming block so it persists even after the process exits -->
        {#if conv.pendingPrompt}
          <div class="msg assistant">
            <div class="msg-assistant">
              <div class="msg-avatar">
                <IconClaude size={18} />
              </div>
              <div class="msg-content">
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
                          onclick={() => claudeSessionStore.respond(conv.id, opt.value, opt.label)}
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
                    <!-- svelte-ignore a11y_autofocus -->
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
    background: var(--bg-base); overflow: hidden;
    position: relative;
  }
  .conversation-view.hidden { display: none; }

  /* ── Streaming progress bar ── */
  .stream-progress {
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 2px;
    z-index: 20;
    overflow: hidden;
    background: var(--accent-bg-subtle);
  }
  .stream-progress-bar {
    height: 100%;
    width: 40%;
    border-radius: 2px;
    background: linear-gradient(90deg, transparent, var(--accent) 30%, var(--blue) 70%, transparent);
    animation: stream-slide 1.8s cubic-bezier(0.4, 0, 0.2, 1) infinite;
  }
  @keyframes stream-slide {
    0%   { transform: translateX(-100%); }
    100% { transform: translateX(350%); }
  }

  .view-drop-overlay {
    position: absolute; inset: 0; z-index: 50;
    display: flex; align-items: center; justify-content: center;
    background: rgba(40, 44, 52, 0.9); pointer-events: none;
  }
  .view-drop-box {
    display: flex; flex-direction: column; align-items: center; gap: 12px;
    padding: 40px 60px; border: 2px dashed var(--blue); border-radius: 20px;
    color: var(--blue); font-size: 16px; font-weight: 600;
  }

  .messages-scroll { flex: 1; overflow-y: auto; overflow-x: hidden; }
  .messages-scroll::-webkit-scrollbar { width: 5px; }
  .messages-scroll::-webkit-scrollbar-track { background: transparent; }
  .messages-scroll::-webkit-scrollbar-thumb { background: transparent; border-radius: 3px; }
  .messages-scroll:hover::-webkit-scrollbar-thumb { background: var(--border); }

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
    background: var(--accent-glow);
    color: var(--accent); margin-bottom: 20px;
  }
  .welcome h2 {
    font-size: 24px; font-weight: 600; color: var(--text-primary);
    margin: 0 0 8px; letter-spacing: -0.02em;
  }
  .welcome-sub { font-size: 14px; color: var(--text-muted); margin: 0; line-height: 1.5; }

  /* ────────────────── Messages ────────────────── */
  .msg { margin-bottom: 2px; }

  .msg-user { display: flex; justify-content: flex-end; padding: 8px 0; }
  .msg-user-bubble {
    max-width: 85%; padding: 10px 16px; border-radius: 18px 18px 4px 18px;
    background: var(--bg-raised); color: var(--text-primary);
    font-size: 14px; line-height: 1.6;
    font-family: 'Pretendard Variable', Pretendard, -apple-system, sans-serif;
    white-space: pre-wrap; word-break: break-word;
    border: 1px solid var(--border);
  }
  .msg-skill-badge {
    display: inline-block;
    font-size: 10px; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 1px 6px; margin-right: 6px;
    border-radius: 4px;
    background: rgba(122, 190, 117, 0.12);
    color: var(--green-soft);
    vertical-align: middle;
  }
  .msg-assistant { display: flex; gap: 12px; padding: 12px 0; }
  .msg-avatar {
    width: 28px; height: 28px; border-radius: 10px;
    display: flex; align-items: center; justify-content: center;
    background: var(--accent-glow); color: var(--accent);
    flex-shrink: 0; margin-top: 2px;
  }
  .msg-content { flex: 1; min-width: 0; padding-top: 2px; }

  /* ────────────────── Markdown ────────────────── */
  .md {
    font-size: 14px; line-height: 1.7; color: var(--text-primary);
    font-family: 'Pretendard Variable', Pretendard, -apple-system, sans-serif;
    overflow-wrap: break-word; word-break: break-word;
  }
  .md :global(h1) { font-size: 20px; font-weight: 700; color: var(--yellow); margin: 20px 0 8px; }
  .md :global(h2) { font-size: 17px; font-weight: 600; color: var(--yellow); margin: 18px 0 6px; }
  .md :global(h3) { font-size: 15px; font-weight: 600; color: var(--yellow); margin: 14px 0 4px; }
  .md :global(p) { margin: 0 0 10px; }
  .md :global(p:last-child) { margin-bottom: 0; }
  .md :global(a) { color: var(--blue); text-decoration: none; }
  .md :global(a:hover) { text-decoration: underline; }
  .md :global(strong) { font-weight: 600; color: var(--orange); }
  .md :global(em) { color: var(--text-secondary); }
  .md :global(code) {
    font-family: var(--font-mono);
    background: var(--bg-surface); color: var(--red); padding: 1px 5px; border-radius: 4px;
    font-size: 0.85em; border: 1px solid var(--border);
  }
  .md :global(pre) {
    background: var(--bg-deep); border: 1px solid var(--border); border-radius: 10px;
    padding: 14px 16px; margin: 8px 0 12px;
    overflow-x: hidden; white-space: pre-wrap; word-break: break-word;
  }
  .md :global(pre code) {
    background: none; padding: 0; color: var(--text-primary); font-size: 13px;
    line-height: 1.55; border: none;
    white-space: pre-wrap; word-break: break-word;
  }
  .md :global(blockquote) {
    border-left: 2px solid var(--border-strong); padding: 6px 14px; margin: 8px 0 12px;
    color: var(--text-secondary);
  }
  .md :global(ul), .md :global(ol) { padding-left: 22px; margin: 4px 0 10px; }
  .md :global(li) { margin: 3px 0; }
  .md :global(li::marker) { color: var(--text-muted); }
  .md :global(hr) { border: none; border-top: 1px solid var(--border); margin: 16px 0; }
  .md :global(table) { width: 100%; border-collapse: collapse; margin: 8px 0 12px; font-size: 13px; table-layout: fixed; word-break: break-word; }
  .md :global(th) { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--border); color: var(--text-primary); font-weight: 600; }
  .md :global(td) { padding: 6px 12px; border-bottom: 1px solid var(--bg-raised); }
  .md :global(details) {
    margin: 6px 0; padding: 8px 12px; border-radius: 8px;
    background: var(--bg-deep); border: 1px solid var(--border);
  }
  .md :global(summary) { cursor: pointer; font-weight: 500; color: var(--text-muted); font-size: 13px; user-select: none; }
  .md :global(summary:hover) { color: var(--text-secondary); }

  /* ── CLI-like tool activity ── */
  .md :global(.tool-line) {
    display: block;
    font-size: 13px;
    color: var(--text-secondary);
    padding: 3px 0;
    font-family: var(--font-mono);
  }
  .md :global(.tool-line code) {
    color: var(--text-primary);
    background: none;
    padding: 0;
    border: none;
    font-size: 12px;
  }
  .md :global(.tool-agent) {
    display: block;
    font-size: 13px;
    padding: 6px 0 2px;
    border-top: 1px solid var(--border);
    margin-top: 8px;
  }
  .md :global(.tool-agent .tool-desc) {
    font-weight: 400;
    font-size: 12px;
    opacity: 0.7;
  }
  .md :global(.tool-wait) {
    display: block;
    font-size: 13px;
    color: var(--text-muted);
    font-style: italic;
    padding: 3px 0;
  }
  .md :global(.tool-result-summary) {
    font-size: 12px;
    color: var(--text-dim);
    font-family: var(--font-mono);
    padding-left: 8px;
  }

  /* ────────────────── Token Usage ────────────────── */
  .token-usage {
    display: flex; align-items: center; gap: 8px;
    padding: 4px 0 2px; margin-top: 2px;
    font-size: 11px; color: var(--text-muted);
    font-family: var(--font-mono);
  }
  .token-usage svg { opacity: 0.4; flex-shrink: 0; }
  .token-in { color: var(--blue); }
  .token-out { color: var(--accent); }
  .token-cache { color: var(--cyan); }
  .token-cost { color: var(--yellow); font-weight: 600; }

  /* ────────────────── Streaming status ────────────────── */
  .streaming-status {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 0 4px; font-size: 12px; color: var(--text-secondary);
    font-family: var(--font-mono);
    animation: status-fade-in 200ms ease;
  }
  @keyframes status-fade-in { from { opacity: 0; } to { opacity: 1; } }
  .status-indicator { position: relative; width: 8px; height: 8px; flex-shrink: 0; }
  .pulse {
    display: block; width: 8px; height: 8px; border-radius: 50%;
    background: var(--accent); animation: pulse-ring 1.5s ease-in-out infinite;
  }
  @keyframes pulse-ring {
    0% { opacity: 0.4; transform: scale(0.8); }
    50% { opacity: 1; transform: scale(1.2); }
    100% { opacity: 0.4; transform: scale(0.8); }
  }
  .status-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 500px; }

  /* ── Subagent Table ──────────────────────────────────────────────────── */
  .sa-table {
    margin-top: 8px;
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
    animation: status-fade-in 200ms ease;
    font-family: var(--font-mono);
  }
  .sa-table-header {
    display: flex; align-items: center; gap: 6px;
    padding: 7px 12px;
    font-size: 11px; color: var(--text-secondary); font-weight: 500;
    background: var(--bg-base);
    border-bottom: 1px solid var(--border);
    letter-spacing: 0.02em;
  }
  .sa-table-header svg { opacity: 0.6; }
  .sa-table-body {
    display: flex; flex-direction: column;
  }
  .sa-row {
    display: grid;
    grid-template-columns: minmax(100px, 1.2fr) minmax(120px, 2fr) minmax(80px, 1fr) 52px;
    gap: 0;
    align-items: center;
    min-height: 32px;
    border-bottom: 1px solid var(--border-subtle);
  }
  .sa-row:last-child { border-bottom: none; }
  .sa-row-head {
    background: var(--bg-overlay);
    min-height: 26px;
  }
  .sa-row-head .sa-cell {
    font-size: 10px;
    color: var(--border-strong);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 600;
  }
  .sa-row:not(.sa-row-head) {
    background: var(--bg-raised);
    transition: background 120ms ease;
  }
  .sa-row:not(.sa-row-head):hover {
    background: var(--bg-hover);
  }
  .sa-cell {
    padding: 5px 10px;
    font-size: 11px;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .sa-c-name {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .sa-dot {
    width: 7px; height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
    background: var(--sa-color, var(--blue));
    animation: pulse-ring 1.5s ease-in-out infinite;
  }
  .sa-name {
    font-weight: 600;
    color: var(--sa-color, var(--blue));
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sa-bg-badge {
    display: inline-block;
    font-size: 8px;
    font-weight: 700;
    color: var(--text-tertiary);
    background: var(--bg-tertiary);
    border-radius: 3px;
    padding: 0 3px;
    margin-left: 4px;
    vertical-align: middle;
    line-height: 14px;
    letter-spacing: 0.5px;
  }
  .sa-c-status {
    color: var(--text-secondary);
  }
  .sa-status-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: block;
  }
  .sa-c-tools {
    color: var(--text-muted);
    font-size: 10px;
  }
  .sa-tool-list {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: block;
  }
  .sa-muted { color: var(--border); }
  .sa-c-time {
    text-align: right;
    color: var(--text-muted);
    font-size: 10px;
    font-weight: 400;
    padding-right: 12px;
  }

  /* ── Prompt UI ─────────────────────────────────────────────────────────── */
  .prompt-ui {
    display: flex; flex-direction: column; gap: 8px;
    padding: 12px 14px; margin-top: 8px;
    background: var(--bg-inset); border: 1px solid var(--border-muted); border-radius: 10px;
    animation: status-fade-in 200ms ease;
  }
  .prompt-header {
    display: flex; align-items: flex-start; gap: 8px;
    font-size: 13px; color: var(--text-bright); line-height: 1.5;
  }
  .prompt-icon { flex-shrink: 0; color: var(--yellow); margin-top: 2px; }
  .prompt-message {
    white-space: pre-wrap; word-break: break-word;
    max-height: 200px; overflow-y: auto;
  }
  .prompt-tool {
    display: flex; align-items: flex-start; gap: 6px;
    padding: 6px 10px; background: var(--bg-deep); border-radius: 6px;
    font-size: 12px; color: var(--text-primary);
    overflow-wrap: break-word; word-break: break-word;
  }
  .prompt-tool code {
    color: var(--accent); font-family: var(--font-mono);
    font-size: 12px; background: none; padding: 0;
  }
  .prompt-tool-input {
    color: var(--text-secondary); word-break: break-word;
  }
  .prompt-actions {
    display: flex; gap: 8px; flex-wrap: wrap; margin-top: 2px;
  }
  .prompt-btn {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 6px 14px; border: 1px solid var(--border-muted); border-radius: 6px;
    background: var(--bg-inset); color: var(--text-primary); font-size: 12px;
    font-family: var(--font-mono);
    cursor: pointer; transition: all 120ms ease;
  }
  .prompt-btn:hover { background: var(--bg-hover); border-color: var(--border-strong); color: var(--text-bright); }
  .prompt-btn.prompt-yes {
    border-color: rgba(152, 195, 121, 0.4); color: var(--green);
  }
  .prompt-btn.prompt-yes:hover {
    background: rgba(152, 195, 121, 0.12); border-color: var(--green);
  }
  .prompt-btn.prompt-no {
    border-color: rgba(224, 108, 117, 0.4); color: var(--red);
  }
  .prompt-btn.prompt-no:hover {
    background: rgba(224, 108, 117, 0.12); border-color: var(--red);
  }
  .prompt-btn.prompt-always {
    border-color: rgba(229, 192, 123, 0.4); color: var(--yellow);
  }
  .prompt-btn.prompt-always:hover {
    background: rgba(229, 192, 123, 0.12); border-color: var(--yellow);
  }
  .prompt-input-form {
    display: flex; gap: 8px; width: 100%;
  }
  .prompt-text-input {
    flex: 1; padding: 6px 10px;
    background: var(--bg-deep); border: 1px solid var(--border-muted); border-radius: 6px;
    color: var(--text-bright); font-size: 12px;
    font-family: var(--font-mono);
    outline: none;
  }
  .prompt-text-input:focus { border-color: var(--border-strong); }
  .prompt-kbd {
    display: inline-block; padding: 1px 5px; margin-left: 2px;
    background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 3px; font-size: 10px; color: var(--text-secondary);
    font-family: var(--font-mono);
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
    font-size: 11px; font-weight: 600; color: var(--text-muted);
    text-transform: uppercase; letter-spacing: 0.04em;
  }
  .quick-replies-grid {
    display: flex; flex-direction: column; gap: 4px;
  }
  .quick-reply-btn {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 14px; border: 1px solid var(--border); border-radius: 8px;
    background: var(--bg-raised); color: var(--text-primary); font-size: 13px;
    font-family: 'Pretendard Variable', Pretendard, -apple-system, sans-serif;
    cursor: pointer; transition: all 120ms ease; text-align: left;
    line-height: 1.4;
  }
  .quick-reply-btn:hover {
    background: var(--bg-hover); border-color: var(--blue); color: var(--text-bright);
  }
  .quick-reply-btn:active {
    background: rgba(97, 175, 239, 0.12);
  }
  .quick-reply-num {
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 22px; height: 22px; border-radius: 6px;
    background: rgba(97, 175, 239, 0.12); color: var(--blue);
    font-size: 12px; font-weight: 600; flex-shrink: 0;
    font-family: var(--font-mono);
  }
  .quick-reply-label {
    word-break: break-word;
  }
</style>
