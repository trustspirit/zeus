/**
 * Claude Code CLI — detection, version management, model aliases, and updates.
 */
import { execSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { IDEDef } from './store.js'

// ── IDE Detection ──────────────────────────────────────────────────────────────

export const IDE_LIST: IDEDef[] = [
  { id: 'code', name: 'VS Code', cmd: 'code', icon: 'vscode' },
  { id: 'cursor', name: 'Cursor', cmd: 'cursor', icon: 'cursor' },
  { id: 'antigravity', name: 'Anti-Gravities', cmd: 'antigravity', icon: 'antigravity' },
  { id: 'windsurf', name: 'Windsurf', cmd: 'windsurf', icon: 'windsurf' },
  { id: 'zed', name: 'Zed', cmd: 'zed', icon: 'zed' },
  { id: 'idea', name: 'IntelliJ IDEA', cmd: 'idea', icon: 'idea' },
  { id: 'webstorm', name: 'WebStorm', cmd: 'webstorm', icon: 'webstorm' },
  { id: 'sublime', name: 'Sublime Text', cmd: 'subl', icon: 'sublime' },
  { id: 'vim', name: 'Neovim', cmd: 'nvim', icon: 'vim' }
]

export function whichSync(cmd: string): boolean {
  try {
    const whichCmd = process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`
    const result = execSync(whichCmd, {
      encoding: 'utf-8',
      timeout: 3000,
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim()
    return result.length > 0
  } catch {
    return false
  }
}

export function detectInstalledIDEs(): IDEDef[] {
  return IDE_LIST.filter((ide) => whichSync(ide.cmd))
}

// ── Claude Code CLI ────────────────────────────────────────────────────────────

let cachedClaudePath: string | null = null

export function getClaudeCliPath(): string {
  if (cachedClaudePath) return cachedClaudePath

  const shell = process.env.SHELL || '/bin/zsh'
  const strategies = [
    () => execSync(`${shell} -l -c 'which claude'`, { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }).trim(),
    () => {
      const whichCmd = process.platform === 'win32' ? 'where claude' : 'which claude'
      return execSync(whichCmd, { encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] }).trim()
    }
  ]

  for (const strategy of strategies) {
    try {
      const result = strategy()
      if (result) {
        cachedClaudePath = result
        console.log('[zeus] Claude CLI found at:', result)
        return result
      }
    } catch { /* try next strategy */ }
  }

  console.warn('[zeus] Claude CLI not found in PATH, falling back to "claude"')
  return 'claude'
}

/** Reset cached path (call after update) */
export function resetClaudeCliPath(): void {
  cachedClaudePath = null
}

export function isClaudeCodeInstalled(): boolean {
  return whichSync('claude')
}

export function getClaudeCodeVersion(): string | null {
  try {
    return execSync('claude --version', {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim()
  } catch {
    return null
  }
}

export interface ModelAliasInfo {
  alias: string
  fullName: string
  version: string
}

export function getClaudeModelAliases(): ModelAliasInfo[] {
  try {
    const claudePath = getClaudeCliPath()
    const realPath = fs.realpathSync(claudePath)

    let src: string | null = null

    // Strategy 1: npm-installed package (cli.js in parent dir)
    const pkgDir = path.resolve(path.dirname(realPath), '..')
    const cliJs = path.join(pkgDir, 'cli.js')
    if (fs.existsSync(cliJs)) {
      src = fs.readFileSync(cliJs, 'utf-8')
    }

    // Strategy 2: native binary — extract strings containing model aliases
    if (!src) {
      try {
        const raw = execSync(
          `strings "${realPath}" | grep -oE '\\{opus:"claude-[^"]+",sonnet:"claude-[^"]+",haiku:"claude-[^"]+"\\}' | head -1`,
          { encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }
        ).trim()
        if (raw) src = raw
      } catch { /* ignore */ }
    }

    if (!src) return []

    const aliasRegex = /\{(\s*\w+\s*:\s*"claude-[\w-]+"\s*,?\s*)+\}/g
    const matches = src.matchAll(aliasRegex)

    for (const m of matches) {
      const block = m[0]
      const entries = [...block.matchAll(/(\w+)\s*:\s*"(claude-[\w-]+)"/g)]
      if (entries.length < 2) continue

      const models: ModelAliasInfo[] = []
      for (const [, alias, fullName] of entries) {
        const verMatch = fullName.match(/claude-\w+-(\d+(?:-\d+)?)(?:-\d{8})?$/)
        const version = verMatch ? verMatch[1].replace(/-/g, '.') : ''
        models.push({ alias, fullName, version })
      }
      if (models.length >= 2) return models
    }
    return []
  } catch {
    return []
  }
}

export function checkLatestClaudeVersion(): Promise<{ current: string | null; latest: string | null; upToDate: boolean }> {
  return new Promise((resolve) => {
    const current = getClaudeCodeVersion()
    const currentSemver = current?.match(/(\d+\.\d+\.\d+)/)?.[1] ?? null

    const child = spawn('npm', ['view', '@anthropic-ai/claude-code', 'version'], {
      shell: true,
      env: { ...process.env },
      timeout: 15000
    })

    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (d: Buffer) => (stdout += d.toString()))
    child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()))

    child.on('close', (code) => {
      const latest = stdout.trim() || null
      if (code !== 0 || !latest) {
        resolve({ current: currentSemver, latest: null, upToDate: false })
        return
      }
      resolve({ current: currentSemver, latest, upToDate: currentSemver === latest })
    })

    child.on('error', () => {
      resolve({ current: currentSemver, latest: null, upToDate: false })
    })
  })
}

export function updateClaudeCode(): Promise<{ success: boolean; output?: string; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn('npm', ['install', '-g', '@anthropic-ai/claude-code'], {
      shell: true,
      env: { ...process.env }
    })

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (d: Buffer) => (stdout += d.toString()))
    child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()))

    child.on('close', (code) => {
      resetClaudeCliPath()
      if (code === 0) resolve({ success: true, output: stdout })
      else resolve({ success: false, error: stderr || `Exit code ${code}` })
    })

    child.on('error', (err) => {
      resolve({ success: false, error: err.message })
    })
  })
}
