/**
 * Claude Code configuration, MCP health checks, and plugin management.
 */
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { getClaudeCliPath } from './claude-cli.js'

// ── Claude Config ──────────────────────────────────────────────────────────────

function getClaudeConfigPath(): string {
  return path.join(os.homedir(), '.claude.json')
}

export function readClaudeConfig(): object {
  try {
    const p = getClaudeConfigPath()
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch { /* ignore */ }
  return {}
}

export function writeClaudeConfig(config: object): boolean {
  try {
    fs.writeFileSync(getClaudeConfigPath(), JSON.stringify(config, null, 2), 'utf-8')
    return true
  } catch {
    return false
  }
}

export function readProjectClaudeConfig(wsPath: string): object {
  try {
    const p = path.join(wsPath, '.claude', 'settings.json')
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch { /* ignore */ }
  return {}
}

export function writeProjectClaudeConfig(wsPath: string, config: object): boolean {
  try {
    const dir = path.join(wsPath, '.claude')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(config, null, 2), 'utf-8')
    return true
  } catch {
    return false
  }
}

// ── MCP ────────────────────────────────────────────────────────────────────────

export function installMCPPackage(pkg: string): Promise<{ success: boolean; output?: string; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn('npm', ['install', '-g', pkg], { shell: true, env: { ...process.env } })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (d: Buffer) => (stdout += d.toString()))
    child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()))
    child.on('close', (code) => {
      if (code === 0) resolve({ success: true, output: stdout })
      else resolve({ success: false, error: stderr || `Exit code ${code}` })
    })
    child.on('error', (err) => resolve({ success: false, error: err.message }))
  })
}

export interface McpHealthEntry {
  name: string
  command: string
  transport: string
  status: 'connected' | 'failed' | 'unknown'
  error?: string
}

export function checkMcpHealth(): Promise<McpHealthEntry[]> {
  return new Promise((resolve) => {
    const claudePath = getClaudeCliPath()
    const child = spawn(claudePath, ['mcp', 'list'], {
      shell: true,
      env: { ...process.env },
      timeout: 30000
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (d: Buffer) => (stdout += d.toString()))
    child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()))
    child.on('close', () => {
      const entries: McpHealthEntry[] = []
      const combined = stdout + stderr
      for (const line of combined.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('Checking')) continue
        const match = trimmed.match(
          /^(.+?):\s+(.+?)\s*(?:\((\w+)\)\s*)?-\s+[✓✗]\s*(.+)$/
        )
        if (!match) continue
        const [, rawName, command, transport, statusText] = match
        const connected = statusText.trim().toLowerCase().includes('connected')
        entries.push({
          name: rawName.trim(),
          command: command.trim(),
          transport: transport || '',
          status: connected ? 'connected' : 'failed',
          error: connected ? undefined : statusText.trim()
        })
      }
      resolve(entries)
    })
    child.on('error', () => resolve([]))
  })
}

// ── Plugins ────────────────────────────────────────────────────────────────────

export interface PluginEntry {
  name: string
  version: string
  scope: string
  enabled: boolean
}

export interface MarketplaceEntry {
  name: string
  source: string
}

export function listPlugins(): Promise<PluginEntry[]> {
  return new Promise((resolve) => {
    const claudePath = getClaudeCliPath()
    const child = spawn(claudePath, ['plugin', 'list'], {
      shell: true,
      env: { ...process.env },
      timeout: 15000
    })
    let stdout = ''
    child.stdout?.on('data', (d: Buffer) => (stdout += d.toString()))
    child.on('close', () => {
      const plugins: PluginEntry[] = []
      const blocks = stdout.split(/\n\s*❯\s+/).filter(Boolean)
      for (const block of blocks) {
        const lines = block.trim().split('\n')
        const nameLine = lines[0]?.trim()
        if (!nameLine) continue
        const versionLine = lines.find(l => l.includes('Version:'))
        const scopeLine = lines.find(l => l.includes('Scope:'))
        const statusLine = lines.find(l => l.includes('Status:'))
        if (!versionLine || !scopeLine || !statusLine) continue
        if (!nameLine.includes('@')) continue
        plugins.push({
          name: nameLine,
          version: versionLine.replace(/.*Version:\s*/, '').trim(),
          scope: scopeLine.replace(/.*Scope:\s*/, '').trim(),
          enabled: statusLine.includes('enabled')
        })
      }
      resolve(plugins)
    })
    child.on('error', () => resolve([]))
  })
}

export function listMarketplaces(): Promise<MarketplaceEntry[]> {
  return new Promise((resolve) => {
    const claudePath = getClaudeCliPath()
    const child = spawn(claudePath, ['plugin', 'marketplace', 'list'], {
      shell: true,
      env: { ...process.env },
      timeout: 15000
    })
    let stdout = ''
    child.stdout?.on('data', (d: Buffer) => (stdout += d.toString()))
    child.on('close', () => {
      const marketplaces: MarketplaceEntry[] = []
      const blocks = stdout.split(/\n\s*❯\s+/).filter(Boolean)
      for (const block of blocks) {
        const lines = block.trim().split('\n')
        const name = lines[0]?.trim()
        if (!name) continue
        if (!lines.some(l => l.includes('Source:'))) continue
        const source = lines.find(l => l.includes('Source:'))?.replace(/.*Source:\s*/, '').trim() || ''
        marketplaces.push({ name, source })
      }
      resolve(marketplaces)
    })
    child.on('error', () => resolve([]))
  })
}

export function runPluginCmd(
  action: string,
  target: string,
  scope?: string
): Promise<{ success: boolean; output?: string; error?: string }> {
  return new Promise((resolve) => {
    const claudePath = getClaudeCliPath()
    const args = ['plugin', ...action.split(' '), target]
    if (scope && (action === 'install' || action === 'enable' || action === 'disable')) {
      args.push('--scope', scope)
    }
    console.log(`[zeus] Running: ${claudePath} ${args.join(' ')}`)
    const child = spawn(claudePath, args, {
      shell: true,
      env: { ...process.env },
      timeout: 30000
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (d: Buffer) => (stdout += d.toString()))
    child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()))
    child.on('close', (code) => {
      if (code === 0) resolve({ success: true, output: stdout })
      else resolve({ success: false, error: stderr || stdout || `Exit code ${code}` })
    })
    child.on('error', (err) => resolve({ success: false, error: err.message }))
  })
}
