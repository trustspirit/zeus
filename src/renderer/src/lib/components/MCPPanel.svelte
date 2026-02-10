<script lang="ts">
  import { mcpStore } from '../stores/mcp.svelte.js'
  import { terminalStore } from '../stores/terminal.svelte.js'
  import { workspaceStore } from '../stores/workspace.svelte.js'
  import { uiStore } from '../stores/ui.svelte.js'
  import IconPlus from './icons/IconPlus.svelte'

  // ── Tab state ──
  type PanelTab = 'installed' | 'add' | 'marketplace'
  let activeTab = $state<PanelTab>('installed')

  // ── Installed tab state ──
  let editingEnv = $state<string | null>(null)
  let editEnvKey = $state('')
  let editEnvValue = $state('')

  // ── Add tab state ──
  type Transport = 'stdio' | 'http' | 'sse'
  let transport = $state<Transport>('stdio')
  let newName = $state('')
  // stdio fields
  let newCommand = $state('npx')
  let newArgs = $state('')
  // http/sse fields
  let newUrl = $state('')
  let newHeader = $state('')
  // shared
  let newScope = $state<'local' | 'project' | 'user'>('local')
  let newEnvKey = $state('')
  let newEnvValue = $state('')
  let envEntries = $state<Array<{ key: string; value: string }>>([])
  let isAdding = $state(false)

  // ── Marketplace state ──
  let marketFilter = $state('')
  let installingId = $state<string | null>(null)

  interface MarketplaceServer {
    id: string
    name: string
    desc: string
    category: string
    transport: Transport
    url?: string         // for http/sse
    command?: string     // for stdio
    installCmd: string   // full `claude mcp add` command
  }

  const MARKETPLACE: MarketplaceServer[] = [
    // ── Productivity ──
    { id: 'github', name: 'GitHub', desc: 'Issues, PRs, code reviews, and repository management', category: 'Productivity',
      transport: 'http', url: 'https://api.githubcopilot.com/mcp/',
      installCmd: 'claude mcp add --transport http github https://api.githubcopilot.com/mcp/' },
    { id: 'notion', name: 'Notion', desc: 'Read and manage Notion pages and databases', category: 'Productivity',
      transport: 'http', url: 'https://mcp.notion.com/mcp',
      installCmd: 'claude mcp add --transport http notion https://mcp.notion.com/mcp' },
    { id: 'linear', name: 'Linear', desc: 'Issue tracking and project management', category: 'Productivity',
      transport: 'http', url: 'https://mcp.linear.app/sse',
      installCmd: 'claude mcp add --transport sse linear https://mcp.linear.app/sse' },
    { id: 'asana', name: 'Asana', desc: 'Task and project management', category: 'Productivity',
      transport: 'sse', url: 'https://mcp.asana.com/sse',
      installCmd: 'claude mcp add --transport sse asana https://mcp.asana.com/sse' },
    { id: 'slack', name: 'Slack', desc: 'Channel messages and workspace search', category: 'Productivity',
      transport: 'http', url: 'https://mcp.slack.com/sse',
      installCmd: 'claude mcp add --transport sse slack https://mcp.slack.com/sse' },
    // ── Monitoring & Analytics ──
    { id: 'sentry', name: 'Sentry', desc: 'Error monitoring, stack traces, and issue tracking', category: 'Monitoring',
      transport: 'http', url: 'https://mcp.sentry.dev/mcp',
      installCmd: 'claude mcp add --transport http sentry https://mcp.sentry.dev/mcp' },
    { id: 'datadog', name: 'Datadog', desc: 'APM, logs, and infrastructure monitoring', category: 'Monitoring',
      transport: 'http', url: 'https://mcp.datadoghq.com/mcp',
      installCmd: 'claude mcp add --transport http datadog https://mcp.datadoghq.com/mcp' },
    // ── Cloud & Infrastructure ──
    { id: 'cloudflare', name: 'Cloudflare', desc: 'Workers, DNS, and edge deployments', category: 'Cloud',
      transport: 'http', url: 'https://mcp.cloudflare.com/sse',
      installCmd: 'claude mcp add --transport sse cloudflare https://mcp.cloudflare.com/sse' },
    { id: 'stripe', name: 'Stripe', desc: 'Payments, subscriptions, and billing', category: 'Cloud',
      transport: 'http', url: 'https://mcp.stripe.com',
      installCmd: 'claude mcp add --transport http stripe https://mcp.stripe.com' },
    { id: 'paypal', name: 'PayPal', desc: 'Payment processing and transactions', category: 'Cloud',
      transport: 'http', url: 'https://mcp.paypal.com/mcp',
      installCmd: 'claude mcp add --transport http paypal https://mcp.paypal.com/mcp' },
    // ── Database ──
    { id: 'postgres', name: 'PostgreSQL', desc: 'Query and manage PostgreSQL databases', category: 'Database',
      transport: 'stdio', command: 'npx -y @bytebase/dbhub',
      installCmd: 'claude mcp add --transport stdio postgres -- npx -y @bytebase/dbhub' },
    { id: 'supabase', name: 'Supabase', desc: 'Database, auth, and storage', category: 'Database',
      transport: 'http', url: 'https://mcp.supabase.com',
      installCmd: 'claude mcp add --transport http supabase https://mcp.supabase.com' },
    // ── Development ──
    { id: 'puppeteer', name: 'Puppeteer', desc: 'Browser automation and web scraping', category: 'Development',
      transport: 'stdio', command: 'npx -y @modelcontextprotocol/server-puppeteer',
      installCmd: 'claude mcp add --transport stdio puppeteer -- npx -y @modelcontextprotocol/server-puppeteer' },
    { id: 'filesystem', name: 'Filesystem', desc: 'File operations with sandboxed access', category: 'Development',
      transport: 'stdio', command: 'npx -y @modelcontextprotocol/server-filesystem',
      installCmd: 'claude mcp add --transport stdio filesystem -- npx -y @modelcontextprotocol/server-filesystem' },
    { id: 'sequential-thinking', name: 'Sequential Thinking', desc: 'Step-by-step problem solving', category: 'Development',
      transport: 'stdio', command: 'npx -y @modelcontextprotocol/server-sequential-thinking',
      installCmd: 'claude mcp add --transport stdio sequential-thinking -- npx -y @modelcontextprotocol/server-sequential-thinking' },
    { id: 'brave-search', name: 'Brave Search', desc: 'Web search via Brave Search API', category: 'Development',
      transport: 'stdio', command: 'npx -y @modelcontextprotocol/server-brave-search',
      installCmd: 'claude mcp add --transport stdio brave-search -- npx -y @modelcontextprotocol/server-brave-search' },
    // ── Design ──
    { id: 'figma', name: 'Figma', desc: 'Read Figma designs and components', category: 'Design',
      transport: 'http', url: 'https://mcp.figma.com/mcp',
      installCmd: 'claude mcp add --transport http figma https://mcp.figma.com/mcp' },
  ]

  const filteredMarketplace = $derived.by(() => {
    if (!marketFilter.trim()) return MARKETPLACE
    const q = marketFilter.toLowerCase()
    return MARKETPLACE.filter(
      (s) => s.name.toLowerCase().includes(q) || s.desc.toLowerCase().includes(q) || s.category.toLowerCase().includes(q)
    )
  })

  const marketCategories = $derived.by(() => {
    const cats = new Map<string, MarketplaceServer[]>()
    for (const s of filteredMarketplace) {
      if (!cats.has(s.category)) cats.set(s.category, [])
      cats.get(s.category)!.push(s)
    }
    return cats
  })

  const installedNames = $derived(new Set(mcpStore.servers.map((s) => s.name)))

  $effect(() => {
    mcpStore.load()
  })

  // ── Installed tab helpers ──
  async function removeServer(name: string) {
    await mcpStore.removeServer(name)
    uiStore.showToast(`Removed: ${name}`, 'info')
  }

  async function addEnvToServer(serverName: string) {
    if (!editEnvKey.trim()) return
    await mcpStore.updateServerEnv(serverName, editEnvKey.trim(), editEnvValue)
    editEnvKey = ''
    editEnvValue = ''
    uiStore.showToast(`Updated env for ${serverName}`, 'info')
  }

  async function removeEnvFromServer(serverName: string, key: string) {
    await mcpStore.removeServerEnv(serverName, key)
  }

  // ── Add tab helpers ──
  function resetAddForm() {
    newName = ''
    newCommand = 'npx'
    newArgs = ''
    newUrl = ''
    newHeader = ''
    newScope = 'local'
    envEntries = []
    newEnvKey = ''
    newEnvValue = ''
  }

  function addEnvEntry() {
    if (newEnvKey.trim()) {
      envEntries = [...envEntries, { key: newEnvKey.trim(), value: newEnvValue }]
      newEnvKey = ''
      newEnvValue = ''
    }
  }

  function removeEnvEntry(idx: number) {
    envEntries = envEntries.filter((_, i) => i !== idx)
  }

  async function addServer() {
    if (!newName.trim()) {
      uiStore.showToast('Server name is required', 'error')
      return
    }

    if (transport === 'stdio') {
      if (!newCommand.trim()) {
        uiStore.showToast('Command is required', 'error')
        return
      }
      // Build `claude mcp add` command for stdio
      let cmd = `claude mcp add --transport stdio --scope ${newScope}`
      for (const e of envEntries) {
        cmd += ` --env ${e.key}=${e.value}`
      }
      cmd += ` ${newName.trim()} -- ${newCommand.trim()}`
      if (newArgs.trim()) cmd += ` ${newArgs.trim()}`

      await runMcpCommand(cmd)
    } else {
      // http or sse
      if (!newUrl.trim()) {
        uiStore.showToast('URL is required', 'error')
        return
      }
      let cmd = `claude mcp add --transport ${transport} --scope ${newScope}`
      if (newHeader.trim()) {
        cmd += ` --header "${newHeader.trim()}"`
      }
      cmd += ` ${newName.trim()} ${newUrl.trim()}`

      await runMcpCommand(cmd)
    }

    resetAddForm()
    activeTab = 'installed'
  }

  // ── Marketplace helpers ──
  async function installFromMarketplace(server: MarketplaceServer) {
    installingId = server.id
    await runMcpCommand(server.installCmd)
    installingId = null
  }

  // ── Shared: run a `claude mcp` command in a terminal tab ──
  async function runMcpCommand(cmd: string) {
    const cwd = workspaceStore.active?.path
    const id = await terminalStore.create(cwd)
    uiStore.activeView = 'terminal'

    // Wait for terminal to be rendered
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
    try {
      const el = document.getElementById(`terminal-${id}`)
      if (el) terminalStore.attach(id, `terminal-${id}`)
    } catch { /* already attached */ }

    terminalStore.sendInput(id, cmd)
    uiStore.showToast(`Running: ${cmd.split(' ').slice(0, 4).join(' ')}...`, 'info')

    // Reload MCP servers after a delay to pick up changes
    setTimeout(() => mcpStore.load(), 5000)
  }

  function transportIcon(t: Transport): string {
    switch (t) {
      case 'http': return '🌐'
      case 'sse': return '📡'
      case 'stdio': return '⚙️'
    }
  }

  function categoryIcon(cat: string): string {
    switch (cat) {
      case 'Productivity': return '📋'
      case 'Monitoring': return '📊'
      case 'Cloud': return '☁️'
      case 'Database': return '🗄️'
      case 'Development': return '🛠️'
      case 'Design': return '🎨'
      default: return '📦'
    }
  }
</script>

<div class="mcp-panel">
  <!-- Tab strip -->
  <div class="panel-tabs">
    <button class="ptab" class:active={activeTab === 'installed'} onclick={() => (activeTab = 'installed')}>
      Installed
      {#if mcpStore.servers.length > 0}
        <span class="ptab-count">{mcpStore.servers.length}</span>
      {/if}
    </button>
    <button class="ptab" class:active={activeTab === 'add'} onclick={() => (activeTab = 'add')}>
      Add Server
    </button>
    <button class="ptab" class:active={activeTab === 'marketplace'} onclick={() => (activeTab = 'marketplace')}>
      Marketplace
    </button>
  </div>

  <!-- ═══════════ Installed ═══════════ -->
  {#if activeTab === 'installed'}
    <div class="tab-content">
      {#if mcpStore.loading}
        <div class="loading"><div class="spinner"></div></div>
      {:else if mcpStore.servers.length === 0}
        <div class="empty">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
          </svg>
          <p>No MCP servers configured.</p>
          <p class="hint-text">Add servers from the <button class="link-btn" onclick={() => (activeTab = 'marketplace')}>Marketplace</button> or <button class="link-btn" onclick={() => (activeTab = 'add')}>Add Server</button> tab.</p>
        </div>
      {:else}
        <div class="server-list">
          {#each mcpStore.servers as server (server.name)}
            <div class="server-card">
              <div class="server-header">
                <div class="server-info">
                  <span class="server-name">{server.name}</span>
                  <span class="server-cmd">{server.command} {server.args.join(' ')}</span>
                </div>
                <div class="server-actions">
                  <button
                    class="icon-btn-sm"
                    title="Edit env vars"
                    onclick={() => (editingEnv = editingEnv === server.name ? null : server.name)}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                  </button>
                  <button class="icon-btn-sm danger" title="Remove" onclick={() => removeServer(server.name)}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  </button>
                </div>
              </div>

              {#if editingEnv === server.name}
                <div class="env-section">
                  {#each Object.entries(server.env) as [key, value] (key)}
                    <div class="env-row">
                      <span class="env-key">{key}</span>
                      <span class="env-eq">=</span>
                      <span class="env-val">{value ? '••••••' : '(empty)'}</span>
                      <button class="remove-btn" onclick={() => removeEnvFromServer(server.name, key)}>&times;</button>
                    </div>
                  {/each}
                  <div class="env-add-row">
                    <input class="form-input small" bind:value={editEnvKey} placeholder="KEY" />
                    <input class="form-input small" bind:value={editEnvValue} placeholder="value" type="password" />
                    <button class="add-env-btn" onclick={() => addEnvToServer(server.name)}>+</button>
                  </div>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>

  <!-- ═══════════ Add Server ═══════════ -->
  {:else if activeTab === 'add'}
    <div class="tab-content">
      <div class="add-form">
        <!-- Transport selector -->
        <div class="form-group">
          <label class="form-label">Transport</label>
          <div class="transport-row">
            <button class="transport-btn" class:active={transport === 'stdio'} onclick={() => (transport = 'stdio')}>
              <span class="t-icon">⚙️</span> stdio
            </button>
            <button class="transport-btn" class:active={transport === 'http'} onclick={() => (transport = 'http')}>
              <span class="t-icon">🌐</span> HTTP
            </button>
            <button class="transport-btn" class:active={transport === 'sse'} onclick={() => (transport = 'sse')}>
              <span class="t-icon">📡</span> SSE
            </button>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Server Name</label>
          <input class="form-input" bind:value={newName} placeholder="e.g. github, sentry, my-server" />
        </div>

        {#if transport === 'stdio'}
          <div class="form-group">
            <label class="form-label">Command</label>
            <input class="form-input" bind:value={newCommand} placeholder="e.g. npx, node, python" />
          </div>
          <div class="form-group">
            <label class="form-label">Arguments <span class="hint">(space-separated)</span></label>
            <input class="form-input" bind:value={newArgs} placeholder="e.g. -y @modelcontextprotocol/server-github" />
          </div>
        {:else}
          <div class="form-group">
            <label class="form-label">URL</label>
            <input class="form-input" bind:value={newUrl} placeholder="https://mcp.example.com/mcp" />
          </div>
          <div class="form-group">
            <label class="form-label">Header <span class="hint">(optional, e.g. Authorization: Bearer ...)</span></label>
            <input class="form-input" bind:value={newHeader} placeholder="Authorization: Bearer your-token" />
          </div>
        {/if}

        <!-- Scope selector -->
        <div class="form-group">
          <label class="form-label">Scope</label>
          <div class="transport-row">
            <button class="transport-btn" class:active={newScope === 'local'} onclick={() => (newScope = 'local')}>Local</button>
            <button class="transport-btn" class:active={newScope === 'project'} onclick={() => (newScope = 'project')}>Project</button>
            <button class="transport-btn" class:active={newScope === 'user'} onclick={() => (newScope = 'user')}>User</button>
          </div>
          <span class="scope-hint">
            {#if newScope === 'local'}Only you, this project{:else if newScope === 'project'}Shared via .mcp.json{:else}You, all projects{/if}
          </span>
        </div>

        {#if transport === 'stdio'}
          <div class="form-group">
            <label class="form-label">Environment Variables</label>
            {#each envEntries as entry, i (i)}
              <div class="env-row">
                <span class="env-key">{entry.key}</span>
                <span class="env-eq">=</span>
                <span class="env-val">{entry.value ? '••••' : '(empty)'}</span>
                <button class="remove-btn" onclick={() => removeEnvEntry(i)}>&times;</button>
              </div>
            {/each}
            <div class="env-add-row">
              <input class="form-input small" bind:value={newEnvKey} placeholder="KEY" />
              <input class="form-input small" bind:value={newEnvValue} placeholder="value" type="password" />
              <button class="add-env-btn" onclick={addEnvEntry}>+</button>
            </div>
          </div>
        {/if}

        <div class="form-actions">
          <button class="btn secondary" onclick={resetAddForm}>Reset</button>
          <button class="btn primary" onclick={addServer} disabled={isAdding}>
            {isAdding ? 'Adding…' : 'Add Server'}
          </button>
        </div>
      </div>

      <!-- Quick tip -->
      <div class="quick-tip">
        <p>The server will be added by running <code>claude mcp add</code> in a terminal. Some servers require OAuth authentication — follow the browser prompts if needed.</p>
      </div>
    </div>

  <!-- ═══════════ Marketplace ═══════════ -->
  {:else if activeTab === 'marketplace'}
    <div class="tab-content">
      <div class="market-search">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input
          class="market-search-input"
          bind:value={marketFilter}
          placeholder="Search servers..."
        />
      </div>

      <div class="market-list">
        {#each [...marketCategories] as [cat, servers] (cat)}
          <div class="market-category">
            <div class="market-cat-header">
              <span class="cat-icon">{categoryIcon(cat)}</span>
              <span class="cat-name">{cat}</span>
              <span class="cat-count">{servers.length}</span>
            </div>
            {#each servers as server (server.id)}
              <div class="market-item" class:installed={installedNames.has(server.id)}>
                <div class="market-item-info">
                  <div class="market-item-top">
                    <span class="market-name">{server.name}</span>
                    <span class="transport-badge">{transportIcon(server.transport)} {server.transport}</span>
                  </div>
                  <span class="market-desc">{server.desc}</span>
                </div>
                <div class="market-item-action">
                  {#if installedNames.has(server.id)}
                    <span class="installed-badge">Installed</span>
                  {:else}
                    <button
                      class="install-btn"
                      disabled={installingId === server.id}
                      onclick={() => installFromMarketplace(server)}
                    >
                      {installingId === server.id ? '…' : 'Install'}
                    </button>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/each}

        {#if filteredMarketplace.length === 0}
          <div class="empty">
            <p>No servers matching "{marketFilter}"</p>
          </div>
        {/if}
      </div>

      <div class="market-footer">
        <a class="market-link" href="https://github.com/modelcontextprotocol/servers" target="_blank" rel="noopener">
          Find more on GitHub →
        </a>
      </div>
    </div>
  {/if}
</div>

<style>
  .mcp-panel { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

  /* ── Panel tabs ── */
  .panel-tabs {
    display: flex; gap: 0; flex-shrink: 0;
    border-bottom: 1px solid #3e4451;
    padding: 0 8px;
  }
  .ptab {
    display: flex; align-items: center; gap: 5px;
    padding: 8px 12px; border: none; border-bottom: 2px solid transparent;
    background: transparent; color: #5c6370; font-size: 11px; font-weight: 500;
    cursor: pointer; font-family: inherit; transition: all 120ms ease;
  }
  .ptab:hover { color: #abb2bf; }
  .ptab.active { color: #c678dd; border-bottom-color: #c678dd; }
  .ptab-count {
    background: #3e4451; color: #7f848e; font-size: 9px; padding: 1px 5px;
    border-radius: 8px; font-weight: 600;
  }

  /* ── Tab content ── */
  .tab-content { flex: 1; overflow-y: auto; padding: 12px; }

  /* ── Loading / Empty ── */
  .loading { display: flex; justify-content: center; padding: 32px; }
  .spinner {
    width: 20px; height: 20px; border: 2px solid #4b5263;
    border-top-color: #c678dd; border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .empty { text-align: center; padding: 32px 16px; color: #5c6370; }
  .empty p { font-size: 13px; line-height: 1.5; margin: 4px 0; }
  .hint-text { font-size: 11px; color: #4b5263; }

  .link-btn {
    border: none; background: none; color: #c678dd; cursor: pointer;
    font-family: inherit; font-size: 11px; text-decoration: underline;
    padding: 0;
  }
  .link-btn:hover { color: #d19eee; }

  /* ── Server cards (Installed) ── */
  .server-list { display: flex; flex-direction: column; gap: 8px; }
  .server-card {
    background: #2c313a; border-radius: 8px; border: 1px solid #3e4451;
    overflow: hidden;
  }
  .server-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 12px; gap: 8px;
  }
  .server-info { flex: 1; min-width: 0; }
  .server-name { display: block; font-size: 13px; font-weight: 500; color: #abb2bf; }
  .server-cmd {
    display: block; font-size: 11px; color: #5c6370; margin-top: 2px;
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .server-actions { display: flex; gap: 4px; flex-shrink: 0; }

  .icon-btn-sm {
    display: flex; align-items: center; justify-content: center;
    width: 24px; height: 24px; border: none; background: transparent;
    color: #5c6370; border-radius: 4px; cursor: pointer;
  }
  .icon-btn-sm:hover { background: #3e4451; color: #abb2bf; }
  .icon-btn-sm.danger:hover { color: #e06c75; }

  /* Env section */
  .env-section {
    padding: 8px 12px 10px; border-top: 1px solid #3e4451; background: #1e2127;
  }
  .env-row {
    display: flex; align-items: center; gap: 6px; padding: 4px 0;
    font-size: 12px; font-family: 'D2Coding', 'JetBrains Mono', monospace;
  }
  .env-key { color: #61afef; }
  .env-eq { color: #5c6370; }
  .env-val { color: #abb2bf; flex: 1; }
  .remove-btn {
    width: 18px; height: 18px; border: none; background: transparent;
    color: #5c6370; cursor: pointer; font-size: 14px; border-radius: 3px;
    display: flex; align-items: center; justify-content: center;
  }
  .remove-btn:hover { background: #3e4451; color: #e06c75; }

  .env-add-row { display: flex; gap: 4px; margin-top: 6px; align-items: center; }
  .env-add-row .form-input { flex: 1; }
  .add-env-btn {
    width: 28px; height: 28px; border: 1px solid #4b5263; background: transparent;
    color: #7f848e; border-radius: 4px; cursor: pointer; font-size: 16px;
    display: flex; align-items: center; justify-content: center;
  }
  .add-env-btn:hover { background: #3e4451; color: #abb2bf; border-color: #5c6370; }

  /* ── Add form ── */
  .add-form {
    background: #2c313a; border-radius: 8px; padding: 14px;
    border: 1px solid #3e4451;
  }
  .form-group { margin-bottom: 12px; }
  .form-label {
    display: block; font-size: 11px; font-weight: 500; color: #7f848e;
    margin-bottom: 5px;
  }
  .form-label .hint { color: #4b5263; font-weight: 400; }
  .form-input {
    width: 100%; padding: 7px 10px; border: 1px solid #4b5263;
    background: #1e2127; color: #abb2bf; border-radius: 5px;
    font-size: 13px; font-family: 'D2Coding', 'JetBrains Mono', 'SF Mono', monospace;
    outline: none; box-sizing: border-box;
  }
  .form-input:focus { border-color: #c678dd; }
  .form-input.small { padding: 5px 8px; font-size: 12px; }

  .transport-row { display: flex; gap: 4px; }
  .transport-btn {
    flex: 1; display: flex; align-items: center; justify-content: center; gap: 4px;
    padding: 6px 8px; border: 1px solid #3e4451; border-radius: 5px;
    background: transparent; color: #5c6370; font-size: 11px; font-weight: 500;
    cursor: pointer; font-family: inherit; transition: all 120ms ease;
  }
  .transport-btn:hover { border-color: #5c6370; color: #abb2bf; }
  .transport-btn.active {
    border-color: #c678dd; color: #c678dd;
    background: rgba(198, 120, 221, 0.06);
  }
  .t-icon { font-size: 12px; }

  .scope-hint {
    display: block; font-size: 10px; color: #4b5263; margin-top: 4px;
    font-style: italic;
  }

  .form-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px; }
  .btn {
    padding: 6px 14px; border: 1px solid #4b5263; border-radius: 5px;
    font-size: 12px; font-weight: 500; cursor: pointer; font-family: inherit;
  }
  .btn.secondary { background: transparent; color: #7f848e; }
  .btn.secondary:hover { background: #3e4451; color: #abb2bf; }
  .btn.primary {
    background: rgba(198, 120, 221, 0.12); border-color: rgba(198, 120, 221, 0.25);
    color: #c678dd;
  }
  .btn.primary:hover { background: rgba(198, 120, 221, 0.2); }
  .btn:disabled { opacity: 0.5; cursor: default; }

  .quick-tip {
    margin-top: 12px; padding: 10px 12px;
    border-radius: 6px; background: rgba(198, 120, 221, 0.04);
    border: 1px solid rgba(198, 120, 221, 0.08);
  }
  .quick-tip p {
    font-size: 11px; color: #5c6370; line-height: 1.5; margin: 0;
  }
  .quick-tip code {
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
    font-size: 11px; color: #c678dd;
    background: #2c313a; padding: 1px 4px; border-radius: 3px;
  }

  /* ── Marketplace ── */
  .market-search {
    display: flex; align-items: center; gap: 8px;
    padding: 7px 10px; border: 1px solid #3e4451; border-radius: 6px;
    background: #2c313a; margin-bottom: 12px; color: #4b5263;
  }
  .market-search-input {
    flex: 1; border: none; background: transparent; outline: none;
    color: #abb2bf; font-size: 12px; font-family: inherit;
  }
  .market-search-input::placeholder { color: #4b5263; }

  .market-list { display: flex; flex-direction: column; gap: 4px; }

  .market-category { margin-bottom: 8px; }
  .market-cat-header {
    display: flex; align-items: center; gap: 6px;
    padding: 6px 8px; font-size: 10px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.04em; color: #4b5263;
  }
  .cat-icon { font-size: 12px; }
  .cat-name { flex: 1; }
  .cat-count {
    font-size: 9px; color: #4b5263; background: #2c313a;
    padding: 1px 5px; border-radius: 8px;
  }

  .market-item {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 10px; border-radius: 6px;
    transition: background 100ms ease;
  }
  .market-item:hover { background: #2c313a; }
  .market-item.installed { opacity: 0.6; }

  .market-item-info { flex: 1; min-width: 0; }
  .market-item-top {
    display: flex; align-items: center; gap: 6px; margin-bottom: 2px;
  }
  .market-name { font-size: 13px; font-weight: 500; color: #abb2bf; }
  .transport-badge {
    font-size: 9px; color: #4b5263; background: #2c313a;
    padding: 1px 5px; border-radius: 4px;
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
  }
  .market-desc {
    font-size: 11px; color: #5c6370; line-height: 1.3;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    display: block;
  }

  .market-item-action { flex-shrink: 0; }
  .install-btn {
    padding: 4px 10px; border: 1px solid rgba(198, 120, 221, 0.25);
    border-radius: 5px; background: rgba(198, 120, 221, 0.08);
    color: #c678dd; font-size: 11px; font-weight: 500;
    cursor: pointer; font-family: inherit; transition: all 120ms ease;
  }
  .install-btn:hover { background: rgba(198, 120, 221, 0.15); border-color: #c678dd; }
  .install-btn:disabled { opacity: 0.5; cursor: default; }

  .installed-badge {
    font-size: 10px; color: #98c379; font-weight: 500;
    padding: 3px 8px; border-radius: 4px;
    background: rgba(74, 222, 128, 0.06);
  }

  .market-footer {
    padding: 12px 8px; text-align: center; border-top: 1px solid #2c313a;
    margin-top: 8px;
  }
  .market-link {
    font-size: 11px; color: #c678dd; text-decoration: none;
  }
  .market-link:hover { text-decoration: underline; }
</style>
