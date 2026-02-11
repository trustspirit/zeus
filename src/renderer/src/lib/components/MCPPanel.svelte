<script lang="ts">
  import { onMount } from 'svelte'
  import { mcpStore } from '../stores/mcp.svelte.js'
  import { pluginStore, OFFICIAL_PLUGINS } from '../stores/plugin.svelte.js'
  import { terminalStore } from '../stores/terminal.svelte.js'
  import { workspaceStore } from '../stores/workspace.svelte.js'
  import { uiStore } from '../stores/ui.svelte.js'
  import IconPlus from './icons/IconPlus.svelte'

  // ── Tab state ──
  type PanelTab = 'installed' | 'add' | 'marketplace' | 'plugins'
  let activeTab = $state<PanelTab>('installed')

  // ── Installed tab state ──
  let editingEnv = $state<string | null>(null)
  let editEnvKey = $state('')
  let editEnvValue = $state('')
  let editCommand = $state('')
  let editArgs = $state('')
  let editingConnection = $state(false)

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

  // ── Plugins state ──
  let pluginFilter = $state('')
  let pluginActionId = $state<string | null>(null)
  let addMarketplaceSource = $state('')
  let addingMarketplace = $state(false)
  let pluginInstallName = $state('')
  let pluginInstallScope = $state<'user' | 'project'>('user')
  let installingPlugin = $state(false)

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

  onMount(() => {
    mcpStore.load()
    mcpStore.checkHealth()
    pluginStore.load()
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

  async function handleDisconnect(name: string) {
    await mcpStore.disconnect(name)
    uiStore.showToast(`Disconnected: ${name}`, 'info')
  }

  async function handleConnect(name: string) {
    await mcpStore.connect(name)
    uiStore.showToast(`Connected: ${name}`, 'success')
    mcpStore.checkHealth()
  }

  function openServerSettings(server: typeof mcpStore.servers[0]) {
    editCommand = server.command
    editArgs = server.args.join(' ')
    editingConnection = false
    editingEnv = editingEnv === server.name ? null : server.name
  }

  function startEditConnection(server: typeof mcpStore.servers[0]) {
    editCommand = server.command
    editArgs = server.args.join(' ')
    editingConnection = true
  }

  async function saveConnection(name: string) {
    const args = editArgs.trim() ? editArgs.trim().split(/\s+/) : []
    await mcpStore.updateServer(name, editCommand.trim(), args)
    editingConnection = false
    uiStore.showToast(`Updated: ${name}`, 'success')
    // Re-check health after connection change
    mcpStore.checkHealth()
  }

  function cancelEditConnection(server: typeof mcpStore.servers[0]) {
    editCommand = server.command
    editArgs = server.args.join(' ')
    editingConnection = false
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

  // ── Plugin helpers ──
  /** Filter for Discover tab — uses marketFilter */
  const filteredOfficialPlugins = $derived.by(() => {
    if (!marketFilter.trim()) return OFFICIAL_PLUGINS
    const q = marketFilter.toLowerCase()
    return OFFICIAL_PLUGINS.filter(
      (p: typeof OFFICIAL_PLUGINS[0]) => p.name.toLowerCase().includes(q) || p.desc.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)
    )
  })

  const pluginCategories = $derived.by(() => {
    const cats = new Map<string, typeof pluginStore.constructor.OFFICIAL_PLUGINS>()
    for (const p of filteredOfficialPlugins) {
      if (!cats.has(p.category)) cats.set(p.category, [])
      cats.get(p.category)!.push(p)
    }
    return cats
  })

  async function togglePlugin(name: string, currentlyEnabled: boolean, scope?: string) {
    pluginActionId = name
    if (currentlyEnabled) {
      const ok = await pluginStore.disable(name, scope)
      uiStore.showToast(ok ? `Disabled: ${name}` : `Failed to disable: ${name}`, ok ? 'info' : 'error')
    } else {
      const ok = await pluginStore.enable(name, scope)
      uiStore.showToast(ok ? `Enabled: ${name}` : `Failed to enable: ${name}`, ok ? 'success' : 'error')
    }
    pluginActionId = null
  }

  async function uninstallPlugin(name: string) {
    pluginActionId = name
    const ok = await pluginStore.uninstall(name)
    if (ok) uiStore.showToast(`Uninstalled: ${name}`, 'info')
    else uiStore.showToast(`Failed to uninstall: ${name}`, 'error')
    pluginActionId = null
  }

  async function installOfficialPlugin(id: string) {
    pluginActionId = id
    const ok = await pluginStore.install(id, 'user')
    if (ok) uiStore.showToast(`Installed: ${id}`, 'success')
    else uiStore.showToast(`Failed to install: ${id}`, 'error')
    pluginActionId = null
  }

  async function installPluginByName() {
    if (!pluginInstallName.trim()) return
    installingPlugin = true
    const ok = await pluginStore.install(pluginInstallName.trim(), pluginInstallScope)
    if (ok) {
      uiStore.showToast(`Installed: ${pluginInstallName.trim()}`, 'success')
      pluginInstallName = ''
    } else {
      uiStore.showToast(`Failed to install: ${pluginInstallName.trim()}`, 'error')
    }
    installingPlugin = false
  }

  async function addMarketplaceRepo() {
    if (!addMarketplaceSource.trim()) return
    addingMarketplace = true
    const ok = await pluginStore.addMarketplace(addMarketplaceSource.trim())
    if (ok) {
      uiStore.showToast(`Added marketplace: ${addMarketplaceSource.trim()}`, 'success')
      addMarketplaceSource = ''
    } else {
      uiStore.showToast(`Failed to add marketplace`, 'error')
    }
    addingMarketplace = false
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
      case 'Writing': return '✍️'
      default: return '📦'
    }
  }
</script>

<div class="mcp-panel">
  <!-- Tab strip -->
  <div class="panel-tabs">
    <button class="ptab" class:active={activeTab === 'installed'} onclick={() => (activeTab = 'installed')}>
      MCP
      {#if mcpStore.servers.length > 0}
        <span class="ptab-count">{mcpStore.servers.length}</span>
      {/if}
    </button>
    <button class="ptab" class:active={activeTab === 'plugins'} onclick={() => (activeTab = 'plugins')}>
      Plugins
      {#if pluginStore.plugins.length > 0}
        <span class="ptab-count">{pluginStore.plugins.length}</span>
      {/if}
    </button>
    <button class="ptab" class:active={activeTab === 'add'} onclick={() => (activeTab = 'add')}>
      Add
    </button>
    <button class="ptab" class:active={activeTab === 'marketplace'} onclick={() => (activeTab = 'marketplace')}>
      Discover
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
            {@const h = server.enabled ? mcpStore.getHealth(server.name) : undefined}
            <div class="server-card" class:disabled-card={!server.enabled}>
              <div class="server-header">
                <div class="server-info">
                  <div class="server-name-row">
                    <span class="server-name">{server.name}</span>
                    {#if !server.enabled}
                      <span class="health-badge disconnected">● Disconnected</span>
                    {:else if h}
                      <span class="health-badge" class:connected={h.status === 'connected'} class:failed={h.status === 'failed'}>
                        {h.status === 'connected' ? '● Connected' : '● Failed'}
                      </span>
                    {:else if mcpStore.healthLoading}
                      <span class="health-badge checking">● Checking…</span>
                    {:else}
                      <span class="health-badge unknown">● Unknown</span>
                    {/if}
                    {#if h?.transport}
                      <span class="transport-badge badge-{h.transport.toLowerCase()}">{h.transport.toLowerCase()}</span>
                    {/if}
                  </div>
                  <span class="server-cmd">{server.command} {server.args.join(' ')}</span>
                  {#if h?.status === 'failed' && h.error}
                    <span class="health-error">{h.error}</span>
                  {/if}
                </div>
                <div class="server-actions">
                  {#if server.enabled}
                    <button
                      class="toggle-btn enabled"
                      title="Connected — click to disconnect"
                      onclick={() => handleDisconnect(server.name)}
                    >
                      <div class="toggle-track"><div class="toggle-thumb"></div></div>
                    </button>
                  {:else}
                    <button
                      class="toggle-btn"
                      title="Disconnected — click to connect"
                      onclick={() => handleConnect(server.name)}
                    >
                      <div class="toggle-track"><div class="toggle-thumb"></div></div>
                    </button>
                  {/if}
                  <button
                    class="icon-btn-sm"
                    title="Settings"
                    onclick={() => openServerSettings(server)}
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
                  <!-- Connection config -->
                  <div class="config-group">
                    <div class="config-label-row">
                      <span class="config-label">Connection</span>
                      {#if !editingConnection}
                        <button class="edit-link" onclick={() => startEditConnection(server)}>Edit</button>
                      {/if}
                    </div>
                    {#if editingConnection}
                      <div class="edit-field">
                        <label class="edit-field-label" for="edit-cmd-{server.name}">Command</label>
                        <input id="edit-cmd-{server.name}" class="form-input small" bind:value={editCommand} placeholder="npx, node, python, or URL" />
                      </div>
                      <div class="edit-field">
                        <label class="edit-field-label" for="edit-args-{server.name}">Args</label>
                        <input id="edit-args-{server.name}" class="form-input small" bind:value={editArgs} placeholder="-y @some/mcp-server" />
                      </div>
                      <div class="edit-actions">
                        <button class="btn-sm secondary" onclick={() => cancelEditConnection(server)}>Cancel</button>
                        <button class="btn-sm primary" onclick={() => saveConnection(server.name)}>Save</button>
                      </div>
                    {:else}
                      <div class="config-value">{server.command}{server.args.length ? ' ' + server.args.join(' ') : ''}</div>
                    {/if}
                  </div>

                  <!-- Env vars -->
                  <div class="config-group">
                    <div class="config-label">Environment Variables</div>
                    {#if Object.keys(server.env).length === 0}
                      <div class="config-empty">No environment variables configured</div>
                    {:else}
                      {#each Object.entries(server.env) as [key, value] (key)}
                        <div class="env-row">
                          <span class="env-key">{key}</span>
                          <span class="env-eq">=</span>
                          <span class="env-val">{value ? '••••••' : '(empty)'}</span>
                          <button class="remove-btn" onclick={() => removeEnvFromServer(server.name, key)}>&times;</button>
                        </div>
                      {/each}
                    {/if}
                    <div class="env-add-row">
                      <input class="form-input small" bind:value={editEnvKey} placeholder="KEY" />
                      <input class="form-input small" bind:value={editEnvValue} placeholder="value" type="password" />
                      <button class="add-env-btn" onclick={() => addEnvToServer(server.name)}>+</button>
                    </div>
                  </div>
                </div>
              {/if}
            </div>
          {/each}
        </div>

        <!-- Health check button -->
        <button class="refresh-btn" onclick={() => mcpStore.checkHealth()} disabled={mcpStore.healthLoading}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          {mcpStore.healthLoading ? 'Checking…' : 'Check Health'}
        </button>
      {/if}
    </div>

  <!-- ═══════════ Plugins ═══════════ -->
  {:else if activeTab === 'plugins'}
    <div class="tab-content">
      {#if pluginStore.loading}
        <div class="loading"><div class="spinner"></div></div>
      {:else if pluginStore.plugins.length === 0}
        <div class="empty">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
          </svg>
          <p>No plugins installed.</p>
          <p class="hint-text">Browse the <button class="link-btn" onclick={() => (activeTab = 'marketplace')}>Discover</button> tab to find plugins.</p>
        </div>
      {:else}
        <div class="server-list">
          {#each pluginStore.plugins as plugin (plugin.name)}
            <div class="server-card" class:disabled-card={!plugin.enabled}>
              <div class="server-header">
                <div class="server-info">
                  <div class="plugin-name-row">
                    <span class="server-name">{plugin.name.split('@')[0]}</span>
                    <span class="plugin-marketplace">@{plugin.name.split('@').slice(1).join('@')}</span>
                  </div>
                  <span class="server-cmd">v{plugin.version} · {plugin.scope}</span>
                </div>
                <div class="server-actions">
                  <button
                    class="toggle-btn"
                    class:enabled={plugin.enabled}
                    title={plugin.enabled ? 'Disable' : 'Enable'}
                    disabled={pluginActionId === plugin.name}
                    onclick={() => togglePlugin(plugin.name, plugin.enabled, plugin.scope)}
                  >
                    {#if pluginActionId === plugin.name}
                      <div class="spinner-sm"></div>
                    {:else}
                      <div class="toggle-track">
                        <div class="toggle-thumb"></div>
                      </div>
                    {/if}
                  </button>
                  <button class="icon-btn-sm danger" title="Uninstall" onclick={() => uninstallPlugin(plugin.name)}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  </button>
                </div>
              </div>
            </div>
          {/each}
        </div>
      {/if}

      <!-- Install by name -->
      <div class="plugin-install-section">
        <div class="section-label">Install Plugin</div>
        <div class="plugin-install-row">
          <input
            class="form-input"
            bind:value={pluginInstallName}
            placeholder="plugin-name or plugin@marketplace"
          />
          <select class="scope-select" bind:value={pluginInstallScope}>
            <option value="user">user</option>
            <option value="project">project</option>
          </select>
          <button class="btn primary" disabled={!pluginInstallName.trim() || installingPlugin} onclick={installPluginByName}>
            {installingPlugin ? '…' : 'Install'}
          </button>
        </div>
      </div>

      <!-- Marketplaces -->
      {#if pluginStore.marketplaces.length > 0}
        <div class="plugin-install-section">
          <div class="section-label">Marketplaces</div>
          {#each pluginStore.marketplaces as mp (mp.name)}
            <div class="mp-row">
              <span class="mp-name">{mp.name}</span>
              <span class="mp-source">{mp.source}</span>
            </div>
          {/each}
        </div>
      {/if}

      <!-- Add marketplace -->
      <div class="plugin-install-section">
        <div class="section-label">Add Marketplace</div>
        <div class="plugin-install-row">
          <input
            class="form-input"
            bind:value={addMarketplaceSource}
            placeholder="GitHub user/repo or URL"
          />
          <button class="btn primary" disabled={!addMarketplaceSource.trim() || addingMarketplace} onclick={addMarketplaceRepo}>
            {addingMarketplace ? '…' : 'Add'}
          </button>
        </div>
      </div>

      <button class="refresh-btn" onclick={() => pluginStore.load()}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        Refresh
      </button>
    </div>

  <!-- ═══════════ Add Server ═══════════ -->
  {:else if activeTab === 'add'}
    <div class="tab-content">
      <div class="add-form">
        <!-- svelte-ignore a11y_label_has_associated_control -->
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
          <label class="form-label" for="mcp-new-name">Server Name</label>
          <input id="mcp-new-name" class="form-input" bind:value={newName} placeholder="e.g. github, sentry, my-server" />
        </div>

        {#if transport === 'stdio'}
          <div class="form-group">
            <label class="form-label" for="mcp-new-cmd">Command</label>
            <input id="mcp-new-cmd" class="form-input" bind:value={newCommand} placeholder="e.g. npx, node, python" />
          </div>
          <div class="form-group">
            <label class="form-label" for="mcp-new-args">Arguments <span class="hint">(space-separated)</span></label>
            <input id="mcp-new-args" class="form-input" bind:value={newArgs} placeholder="e.g. -y @modelcontextprotocol/server-github" />
          </div>
        {:else}
          <div class="form-group">
            <label class="form-label" for="mcp-new-url">URL</label>
            <input id="mcp-new-url" class="form-input" bind:value={newUrl} placeholder="https://mcp.example.com/mcp" />
          </div>
          <div class="form-group">
            <label class="form-label" for="mcp-new-header">Header <span class="hint">(optional, e.g. Authorization: Bearer ...)</span></label>
            <input id="mcp-new-header" class="form-input" bind:value={newHeader} placeholder="Authorization: Bearer your-token" />
          </div>
        {/if}

        <!-- svelte-ignore a11y_label_has_associated_control -->
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
          <!-- svelte-ignore a11y_label_has_associated_control -->
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

  <!-- ═══════════ Discover (Marketplace) ═══════════ -->
  {:else if activeTab === 'marketplace'}
    <div class="tab-content">
      <div class="market-search">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input
          class="market-search-input"
          bind:value={marketFilter}
          placeholder="Search plugins & MCP servers..."
        />
      </div>

      <div class="market-list">
        <!-- ── Official Plugins ── -->
        <div class="market-section-header">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
          Plugins
        </div>

        {#each [...pluginCategories] as [cat, plugins] (cat)}
          <div class="market-category">
            <div class="market-cat-header">
              <span class="cat-icon">{categoryIcon(cat)}</span>
              <span class="cat-name">{cat}</span>
              <span class="cat-count">{plugins.length}</span>
            </div>
            {#each plugins as plugin (plugin.id)}
              {@const entry = pluginStore.installedMap.get(plugin.id) ?? pluginStore.installedMap.get(plugin.id.split('@')[0])}
              <div class="market-item" class:installed={!!entry}>
                <div class="market-item-info">
                  <div class="market-item-top">
                    <span class="market-name">{plugin.name}</span>
                    <span class="transport-badge badge-plugin">🔌 plugin</span>
                  </div>
                  <span class="market-desc">{plugin.desc}</span>
                  <span class="market-source">{plugin.marketplace}</span>
                </div>
                <div class="market-item-action">
                  {#if entry}
                    <button
                      class="toggle-btn-sm"
                      class:enabled={entry.enabled}
                      disabled={pluginActionId === plugin.id || pluginActionId === entry.name}
                      title={entry.enabled ? 'Disable' : 'Enable'}
                      onclick={() => togglePlugin(entry.name, entry.enabled, entry.scope)}
                    >
                      {entry.enabled ? 'On' : 'Off'}
                    </button>
                  {:else}
                    <button
                      class="install-btn"
                      disabled={pluginActionId === plugin.id}
                      onclick={() => installOfficialPlugin(plugin.id)}
                    >
                      {pluginActionId === plugin.id ? '…' : 'Install'}
                    </button>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/each}

        <!-- ── MCP Servers ── -->
        <div class="market-section-header mcp-header">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v6m0 6v6m-7.8-3.6 5.2-3m5.2-3 5.2-3M4.2 5.4l5.2 3m5.2 3 5.2 3"/></svg>
          MCP Servers
        </div>

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
                    <span class="transport-badge badge-{server.transport}">{transportIcon(server.transport)} {server.transport}</span>
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

        {#if filteredMarketplace.length === 0 && filteredOfficialPlugins.length === 0}
          <div class="empty">
            <p>No results for "{marketFilter}"</p>
          </div>
        {/if}
      </div>

      <div class="market-footer">
        <a class="market-link" href="https://github.com/modelcontextprotocol/servers" target="_blank" rel="noopener">
          MCP Servers on GitHub →
        </a>
        <a class="market-link" href="https://github.com/anthropics/claude-plugins-official" target="_blank" rel="noopener">
          Official Plugins →
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
    padding: 0 4px;
  }
  .ptab {
    display: flex; align-items: center; gap: 5px;
    padding: 8px 10px; border: none; border-bottom: 2px solid transparent;
    background: transparent; color: #8b919d; font-size: 11px; font-weight: 500;
    cursor: pointer; font-family: inherit; transition: all 120ms ease;
  }
  .ptab:hover { color: #d4d8e0; }
  .ptab.active { color: #c678dd; border-bottom-color: #c678dd; }
  .ptab-count {
    background: #3e4451; color: #abb2bf; font-size: 9px; padding: 1px 5px;
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

  .empty { text-align: center; padding: 32px 16px; color: #8b919d; }
  .empty p { font-size: 13px; line-height: 1.5; margin: 4px 0; }
  .hint-text { font-size: 11px; color: #7f848e; }

  .link-btn {
    border: none; background: none; color: #c678dd; cursor: pointer;
    font-family: inherit; font-size: 11px; text-decoration: underline;
    padding: 0;
  }
  .link-btn:hover { color: #d19eee; }

  /* ── Server cards (Installed + Plugins) ── */
  .server-list { display: flex; flex-direction: column; gap: 8px; }
  .server-card {
    background: #2c313a; border-radius: 8px; border: 1px solid #3e4451;
    overflow: hidden; transition: opacity 150ms ease;
  }
  .server-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 12px; gap: 8px;
  }
  .server-info { flex: 1; min-width: 0; }
  .server-name-row {
    display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin-bottom: 1px;
  }
  .server-name { font-size: 13px; font-weight: 600; color: #d4d8e0; }
  .health-badge {
    font-size: 9px; font-weight: 700; padding: 2px 7px; border-radius: 10px;
    border: 1px solid transparent; letter-spacing: 0.02em;
  }
  .health-badge.connected {
    color: #b5e08c; background: rgba(152, 195, 121, 0.15);
    border-color: rgba(152, 195, 121, 0.35);
  }
  .health-badge.failed {
    color: #e06c75; background: rgba(224, 108, 117, 0.12);
    border-color: rgba(224, 108, 117, 0.3);
  }
  .health-badge.checking {
    color: #e5c07b; background: rgba(229, 192, 123, 0.1);
    border-color: rgba(229, 192, 123, 0.25);
    animation: pulse-opacity 1.2s ease-in-out infinite;
  }
  .health-badge.unknown {
    color: #7f848e; background: rgba(127, 132, 142, 0.1);
    border-color: rgba(127, 132, 142, 0.2);
  }
  .health-badge.disconnected {
    color: #8b919d; background: rgba(139, 145, 157, 0.1);
    border-color: rgba(139, 145, 157, 0.2);
  }
  @keyframes pulse-opacity { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
  .health-error {
    display: block; font-size: 10px; color: #e06c75; margin-top: 2px;
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .server-cmd {
    display: block; font-size: 11px; color: #8b919d; margin-top: 3px;
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .server-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }

  .icon-btn-sm {
    display: flex; align-items: center; justify-content: center;
    width: 26px; height: 26px; border: none; background: transparent;
    color: #8b919d; border-radius: 4px; cursor: pointer;
  }
  .icon-btn-sm:hover { background: #3e4451; color: #d4d8e0; }
  .icon-btn-sm.danger:hover { color: #e06c75; }


  /* Env / Config section */
  .env-section {
    padding: 10px 12px 12px; border-top: 1px solid #3e4451; background: #1e2127;
  }
  .config-group {
    margin-bottom: 10px;
  }
  .config-group:last-child { margin-bottom: 0; }
  .config-label {
    font-size: 9px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.05em; color: #7f848e; margin-bottom: 4px;
  }
  .config-value {
    font-size: 12px; color: #d4d8e0; word-break: break-all;
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
    background: rgba(255, 255, 255, 0.03); padding: 4px 8px;
    border-radius: 4px; border: 1px solid #2c313a;
  }
  .config-empty {
    font-size: 11px; color: #5c6370; font-style: italic;
    padding: 2px 0;
  }
  .config-label-row {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 4px;
  }
  .config-label-row .config-label { margin-bottom: 0; }
  .edit-link {
    border: none; background: none; color: #d19eee; cursor: pointer;
    font-family: inherit; font-size: 10px; font-weight: 600;
    padding: 0; text-decoration: underline; text-underline-offset: 2px;
  }
  .edit-link:hover { color: #c678dd; }
  .edit-field { margin-bottom: 6px; }
  .edit-field-label {
    display: block; font-size: 9px; color: #7f848e; margin-bottom: 2px;
    font-weight: 600;
  }
  .edit-actions {
    display: flex; gap: 6px; justify-content: flex-end; margin-top: 6px;
  }
  .btn-sm {
    padding: 4px 10px; border-radius: 5px;
    font-size: 11px; font-weight: 600; cursor: pointer; font-family: inherit;
    transition: all 120ms ease;
  }
  .btn-sm.secondary {
    background: transparent; border: 1px solid #4b5263; color: #8b919d;
  }
  .btn-sm.secondary:hover { background: #2c313a; color: #d4d8e0; }
  .btn-sm.primary {
    background: rgba(198, 120, 221, 0.15); border: 1px solid rgba(198, 120, 221, 0.4);
    color: #d19eee;
  }
  .btn-sm.primary:hover { background: rgba(198, 120, 221, 0.25); }
  .env-row {
    display: flex; align-items: center; gap: 6px; padding: 4px 0;
    font-size: 12px; font-family: 'D2Coding', 'JetBrains Mono', monospace;
  }
  .env-key { color: #61afef; font-weight: 500; }
  .env-eq { color: #8b919d; }
  .env-val { color: #d4d8e0; flex: 1; }
  .remove-btn {
    width: 18px; height: 18px; border: none; background: transparent;
    color: #8b919d; cursor: pointer; font-size: 14px; border-radius: 3px;
    display: flex; align-items: center; justify-content: center;
  }
  .remove-btn:hover { background: #3e4451; color: #e06c75; }

  .env-add-row { display: flex; gap: 4px; margin-top: 6px; align-items: center; }
  .env-add-row .form-input { flex: 1; }
  .add-env-btn {
    width: 28px; height: 28px; border: 1px solid #5c6370; background: transparent;
    color: #abb2bf; border-radius: 4px; cursor: pointer; font-size: 16px;
    display: flex; align-items: center; justify-content: center;
  }
  .add-env-btn:hover { background: #3e4451; color: #d4d8e0; border-color: #7f848e; }

  /* ── Add form ── */
  .add-form {
    background: #2c313a; border-radius: 8px; padding: 14px;
    border: 1px solid #3e4451;
  }
  .form-group { margin-bottom: 12px; }
  .form-label {
    display: block; font-size: 11px; font-weight: 600; color: #abb2bf;
    margin-bottom: 5px;
  }
  .form-label .hint { color: #7f848e; font-weight: 400; }
  .form-input {
    width: 100%; padding: 7px 10px; border: 1px solid #5c6370;
    background: #1e2127; color: #d4d8e0; border-radius: 5px;
    font-size: 13px; font-family: 'D2Coding', 'JetBrains Mono', 'SF Mono', monospace;
    outline: none; box-sizing: border-box;
  }
  .form-input:focus { border-color: #c678dd; }
  .form-input::placeholder { color: #5c6370; }
  .form-input.small { padding: 5px 8px; font-size: 12px; }

  .transport-row { display: flex; gap: 4px; }
  .transport-btn {
    flex: 1; display: flex; align-items: center; justify-content: center; gap: 4px;
    padding: 6px 8px; border: 1px solid #4b5263; border-radius: 5px;
    background: transparent; color: #8b919d; font-size: 11px; font-weight: 500;
    cursor: pointer; font-family: inherit; transition: all 120ms ease;
  }
  .transport-btn:hover { border-color: #7f848e; color: #d4d8e0; }
  .transport-btn.active {
    border-color: #c678dd; color: #c678dd;
    background: rgba(198, 120, 221, 0.1);
  }
  .t-icon { font-size: 12px; }

  .scope-hint {
    display: block; font-size: 10px; color: #7f848e; margin-top: 4px;
    font-style: italic;
  }

  .form-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px; }
  .btn {
    padding: 6px 14px; border: 1px solid #5c6370; border-radius: 5px;
    font-size: 12px; font-weight: 500; cursor: pointer; font-family: inherit;
  }
  .btn.secondary { background: transparent; color: #abb2bf; }
  .btn.secondary:hover { background: #3e4451; color: #d4d8e0; }
  .btn.primary {
    background: rgba(198, 120, 221, 0.15); border-color: rgba(198, 120, 221, 0.4);
    color: #d19eee;
  }
  .btn.primary:hover { background: rgba(198, 120, 221, 0.25); }
  .btn:disabled { opacity: 0.5; cursor: default; }

  .quick-tip {
    margin-top: 12px; padding: 10px 12px;
    border-radius: 6px; background: rgba(198, 120, 221, 0.06);
    border: 1px solid rgba(198, 120, 221, 0.12);
  }
  .quick-tip p {
    font-size: 11px; color: #8b919d; line-height: 1.5; margin: 0;
  }
  .quick-tip code {
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
    font-size: 11px; color: #d19eee;
    background: rgba(198, 120, 221, 0.1); padding: 1px 4px; border-radius: 3px;
  }

  /* ── Marketplace / Discover ── */
  .market-search {
    display: flex; align-items: center; gap: 8px;
    padding: 7px 10px; border: 1px solid #4b5263; border-radius: 6px;
    background: #2c313a; margin-bottom: 12px; color: #7f848e;
  }
  .market-search-input {
    flex: 1; border: none; background: transparent; outline: none;
    color: #d4d8e0; font-size: 12px; font-family: inherit;
  }
  .market-search-input::placeholder { color: #6b7280; }

  .market-list { display: flex; flex-direction: column; gap: 4px; }

  .market-category { margin-bottom: 8px; }
  .market-cat-header {
    display: flex; align-items: center; gap: 6px;
    padding: 6px 8px; font-size: 10px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.05em; color: #8b919d;
  }
  .cat-icon { font-size: 12px; }
  .cat-name { flex: 1; }
  .cat-count {
    font-size: 9px; color: #8b919d; background: #3e4451;
    padding: 1px 5px; border-radius: 8px; font-weight: 600;
  }

  .market-item {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 10px; border-radius: 6px;
    border: 1px solid transparent;
    transition: all 100ms ease;
  }
  .market-item:hover { background: #2c313a; border-color: #3e4451; }
  .market-item.installed { opacity: 0.7; }

  .market-item-info { flex: 1; min-width: 0; }
  .market-item-top {
    display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin-bottom: 2px;
  }
  .market-name { font-size: 13px; font-weight: 600; color: #d4d8e0; flex-shrink: 0; }
  .transport-badge {
    font-size: 9px; padding: 2px 7px; border-radius: 4px;
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
    font-weight: 700; letter-spacing: 0.02em;
    border: 1px solid transparent;
  }
  .badge-plugin {
    color: #d19eee; background: rgba(198, 120, 221, 0.15);
    border-color: rgba(198, 120, 221, 0.3);
  }
  .badge-http {
    color: #7cc3f5; background: rgba(97, 175, 239, 0.12);
    border-color: rgba(97, 175, 239, 0.3);
  }
  .badge-sse {
    color: #e5c07b; background: rgba(229, 192, 123, 0.12);
    border-color: rgba(229, 192, 123, 0.3);
  }
  .badge-stdio {
    color: #98c379; background: rgba(152, 195, 121, 0.12);
    border-color: rgba(152, 195, 121, 0.3);
  }
  .market-desc {
    font-size: 11px; color: #8b919d; line-height: 1.3;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    display: block;
  }

  .market-item-action { flex-shrink: 0; }
  .install-btn {
    padding: 4px 14px; border: 1px solid rgba(198, 120, 221, 0.45);
    border-radius: 10px; background: rgba(198, 120, 221, 0.15);
    color: #d19eee; font-size: 11px; font-weight: 700;
    cursor: pointer; font-family: inherit; transition: all 120ms ease;
  }
  .install-btn:hover { background: rgba(198, 120, 221, 0.28); border-color: #c678dd; color: #e0c0f5; }
  .install-btn:disabled { opacity: 0.5; cursor: default; }

  .installed-badge {
    font-size: 10px; color: #b5e08c; font-weight: 700;
    padding: 3px 10px; border-radius: 10px;
    background: rgba(152, 195, 121, 0.15);
    border: 1px solid rgba(152, 195, 121, 0.35);
  }

  .market-footer {
    padding: 12px 8px; text-align: center; border-top: 1px solid #3e4451;
    margin-top: 8px;
  }
  .market-link {
    font-size: 11px; color: #d19eee; text-decoration: none; font-weight: 500;
  }
  .market-link:hover { text-decoration: underline; color: #c678dd; }

  /* ── Plugin toggle ── */
  .toggle-btn {
    display: flex; align-items: center; justify-content: center;
    width: 36px; height: 20px; border: none; background: transparent;
    cursor: pointer; padding: 0; border-radius: 10px;
  }
  .toggle-track {
    width: 32px; height: 16px; border-radius: 8px;
    background: #4b5263; position: relative; transition: background 150ms ease;
  }
  .toggle-btn.enabled .toggle-track { background: #98c379; }
  .toggle-thumb {
    width: 12px; height: 12px; border-radius: 50%;
    background: #d4d8e0; position: absolute; top: 2px; left: 2px;
    transition: left 150ms ease;
  }
  .toggle-btn.enabled .toggle-thumb { left: 18px; background: #fff; }
  .spinner-sm {
    width: 12px; height: 12px; border: 2px solid #5c6370;
    border-top-color: #c678dd; border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .toggle-btn-sm {
    padding: 3px 12px; border-radius: 10px;
    font-size: 10px; font-weight: 700; cursor: pointer;
    font-family: inherit; transition: all 120ms ease;
    letter-spacing: 0.03em;
  }
  .toggle-btn-sm.enabled {
    background: rgba(152, 195, 121, 0.2);
    border: 1px solid rgba(152, 195, 121, 0.5);
    color: #b5e08c;
  }
  .toggle-btn-sm:not(.enabled) {
    background: rgba(224, 108, 117, 0.1);
    border: 1px solid rgba(224, 108, 117, 0.3);
    color: #e06c75;
  }
  .toggle-btn-sm:hover.enabled { background: rgba(152, 195, 121, 0.3); }
  .toggle-btn-sm:hover:not(.enabled) { background: rgba(224, 108, 117, 0.18); }
  .toggle-btn-sm:disabled { opacity: 0.5; cursor: default; }

  .disabled-card { opacity: 0.65; }
  .disabled-card:hover { opacity: 0.9; }

  .plugin-name-row { display: flex; align-items: baseline; gap: 4px; }
  .plugin-marketplace {
    font-size: 10px; color: #7f848e;
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
  }

  /* ── Plugin install section ── */
  .plugin-install-section {
    margin-top: 14px; padding: 12px;
    background: #2c313a; border-radius: 8px; border: 1px solid #3e4451;
  }
  .section-label {
    font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.05em; color: #8b919d; margin-bottom: 8px;
  }
  .plugin-install-row {
    display: flex; gap: 6px; align-items: center;
  }
  .plugin-install-row .form-input { flex: 1; }

  .scope-select {
    padding: 6px 8px; border: 1px solid #5c6370;
    background: #1e2127; color: #d4d8e0; border-radius: 5px;
    font-size: 11px; font-family: 'D2Coding', 'JetBrains Mono', monospace;
    outline: none; cursor: pointer;
  }
  .scope-select:focus { border-color: #c678dd; }

  .mp-row {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 0; font-size: 12px;
    border-bottom: 1px solid rgba(62, 68, 81, 0.5);
  }
  .mp-row:last-child { border-bottom: none; }
  .mp-name { color: #d4d8e0; font-weight: 600; }
  .mp-source {
    font-size: 10px; color: #8b919d;
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
  }

  .refresh-btn {
    display: flex; align-items: center; gap: 6px; margin-top: 12px;
    padding: 7px 12px; border: 1px solid #4b5263; border-radius: 5px;
    background: transparent; color: #8b919d; font-size: 11px; font-weight: 500;
    cursor: pointer; font-family: inherit; transition: all 120ms ease;
    width: 100%; justify-content: center;
  }
  .refresh-btn:hover { border-color: #7f848e; color: #d4d8e0; background: #2c313a; }

  /* ── Market section headers ── */
  .market-section-header {
    display: flex; align-items: center; gap: 6px;
    padding: 10px 8px 6px; font-size: 13px; font-weight: 700;
    color: #d19eee; margin-top: 4px;
  }
  .market-section-header.mcp-header {
    margin-top: 12px; padding-top: 14px;
    border-top: 1px solid #3e4451;
    color: #7cc3f5;
  }

  .market-source {
    display: block; font-size: 9px; color: #7f848e; margin-top: 2px;
    font-family: 'D2Coding', 'JetBrains Mono', monospace;
  }

  .market-footer {
    padding: 12px 8px; text-align: center; border-top: 1px solid #3e4451;
    margin-top: 8px; display: flex; gap: 16px; justify-content: center;
  }
</style>
