/**
 * Subagent JSONL Watcher — monitors child session JSONL files to surface
 * real-time tool activity from subagents.
 *
 * Claude Code's parent stream only shows Task start → TaskOutput result.
 * Subagent internal events (tool calls, thinking, writing) are written to
 * separate JSONL files in ~/.claude/projects/<workspace>/. This module polls
 * those files and relays activity updates to the renderer.
 */
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import type { BrowserWindow } from 'electron'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SubagentWatchTarget {
  taskId?: string
  name: string
  description: string   // prompt/description from the Task tool — used for matching
}

export interface SubagentActivity {
  matchedName?: string
  matchedTaskId?: string
  childSessionId: string
  latestTool?: string   // e.g. "Read", "Bash"
  latestStatus: string  // e.g. "Read: src/App.tsx", "Thinking…"
}

interface WatchState {
  conversationId: string
  parentSessionId: string
  projectDir: string
  targets: SubagentWatchTarget[]
  /** Track read position per file to only process new bytes */
  filePositions: Map<string, number>
  /** Cache child session file → matched subagent name */
  sessionToAgent: Map<string, { name: string; taskId?: string }>
  /** Set of session files that are too old (avoid re-checking) */
  staleFiles: Set<string>
  intervalId: ReturnType<typeof setInterval>
}

// ── Module State ───────────────────────────────────────────────────────────────

let _getWindow: () => BrowserWindow | null = () => null
let _state: WatchState | null = null

// ── Human-readable tool labels ─────────────────────────────────────────────────

const TOOL_LABELS: Record<string, string> = {
  read: 'Reading',
  write: 'Writing',
  edit: 'Editing',
  multiEdit: 'Multi-editing',
  bash: 'Running command',
  glob: 'Searching files',
  grep: 'Searching code',
  ls: 'Listing directory',
  task: 'Dispatching agent',
  taskoutput: 'Waiting for agent',
  webfetch: 'Fetching web',
  todoread: 'Reading TODOs',
  todowrite: 'Writing TODOs',
}

// ── Init ───────────────────────────────────────────────────────────────────────

export function initSubagentWatcher(getWindow: () => BrowserWindow | null): void {
  _getWindow = getWindow
}

// ── Project Directory Resolution ───────────────────────────────────────────────

function findProjectDir(parentSessionId: string, workspacePath: string): string | null {
  const claudeDir = path.join(os.homedir(), '.claude', 'projects')
  if (!fs.existsSync(claudeDir)) return null

  const encoded = workspacePath.replace(/\//g, '-')

  // Direct path check
  const direct = path.join(claudeDir, encoded)
  if (fs.existsSync(direct) && fs.existsSync(path.join(direct, `${parentSessionId}.jsonl`))) {
    return direct
  }

  // Fallback: scan all project dirs for the parent session file
  try {
    for (const dir of fs.readdirSync(claudeDir)) {
      const candidate = path.join(claudeDir, dir)
      if (fs.statSync(candidate).isDirectory()) {
        if (fs.existsSync(path.join(candidate, `${parentSessionId}.jsonl`))) {
          return candidate
        }
      }
    }
  } catch { /* ignore */ }

  return null
}

// ── File Parsing ───────────────────────────────────────────────────────────────

/** Read the tail of a file (last N bytes) */
function readFileTail(filePath: string, bytes: number): string {
  const fd = fs.openSync(filePath, 'r')
  try {
    const stat = fs.fstatSync(fd)
    const start = Math.max(0, stat.size - bytes)
    const len = stat.size - start
    const buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, start)
    return buf.toString('utf-8')
  } finally {
    fs.closeSync(fd)
  }
}

/** Format tool + input into a short status string */
function formatToolStatus(toolName: string, input: Record<string, unknown>): string {
  const label = TOOL_LABELS[toolName] ?? TOOL_LABELS[toolName.toLowerCase()] ?? toolName
  const detail = typeof input.file_path === 'string' ? input.file_path
    : typeof input.command === 'string' ? input.command.slice(0, 60)
    : typeof input.pattern === 'string' ? input.pattern
    : typeof input.query === 'string' ? input.query.slice(0, 60)
    : typeof input.path === 'string' ? input.path
    : ''
  return detail ? `${label}: ${detail}` : label
}

/** Extract the latest activity from JSONL content (reads backwards) */
function extractLatestActivity(content: string): { tool?: string; status: string } | null {
  const lines = content.split('\n').filter(l => l.trim())

  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(lines[i])
      if (obj.type !== 'assistant' || !obj.message?.content) continue

      const blocks = Array.isArray(obj.message.content) ? obj.message.content : []

      // Scan blocks from last to first
      for (let j = blocks.length - 1; j >= 0; j--) {
        const b = blocks[j]
        if (b.type === 'tool_use' && b.name) {
          const input = (b.input && typeof b.input === 'object') ? b.input : {}
          return { tool: b.name, status: formatToolStatus(b.name, input) }
        }
        if (b.type === 'thinking') return { status: 'Thinking…' }
        if (b.type === 'text' && b.text) return { status: 'Writing…' }
      }
    } catch { /* skip */ }
  }
  return null
}

/** Extract first user prompt from a JSONL (first 8KB) — used for matching */
function extractFirstPrompt(filePath: string): string | null {
  try {
    // Read from start of file (we need the first user message)
    const fd = fs.openSync(filePath, 'r')
    const buf = Buffer.alloc(8192)
    const n = fs.readSync(fd, buf, 0, 8192, 0)
    fs.closeSync(fd)
    const head = buf.toString('utf-8', 0, n)
    const lines = head.split('\n')

    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const obj = JSON.parse(line)
        if ((obj.type === 'user' || obj.type === 'human') && obj.message?.role === 'user') {
          const c = obj.message.content
          if (typeof c === 'string') return c.slice(0, 600)
          if (Array.isArray(c)) {
            for (const p of c) {
              if (typeof p === 'string') return p.slice(0, 600)
              if (p?.type === 'text' && typeof p.text === 'string') return p.text.slice(0, 600)
            }
          }
        }
      } catch { /* skip */ }
    }
  } catch { /* ignore */ }
  return null
}

/** Match a child session's first prompt to a known subagent */
function matchToTarget(prompt: string, targets: SubagentWatchTarget[]): SubagentWatchTarget | null {
  if (!prompt || targets.length === 0) return null
  const pLow = prompt.toLowerCase()

  let best: SubagentWatchTarget | null = null
  let bestScore = 0

  for (const t of targets) {
    if (!t.description) continue
    const dLow = t.description.toLowerCase()

    // Check containment: does the prompt contain the description (or vice versa)?
    // Subagent prompts typically START with the description from the Task tool input.
    const descSnippet = dLow.slice(0, 120)
    const promptSnippet = pLow.slice(0, 200)

    if (promptSnippet.includes(descSnippet) || descSnippet.includes(promptSnippet.slice(0, 80))) {
      const score = Math.min(descSnippet.length, promptSnippet.length)
      if (score > bestScore) { bestScore = score; best = t }
    }
  }

  return best
}

// ── Poll Cycle ─────────────────────────────────────────────────────────────────

function poll(): void {
  const s = _state
  if (!s) return

  try {
    const files = fs.readdirSync(s.projectDir)
    const parentFile = `${s.parentSessionId}.jsonl`
    const activities: SubagentActivity[] = []

    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue
      if (file === parentFile) continue
      if (s.staleFiles.has(file)) continue

      const filePath = path.join(s.projectDir, file)

      try {
        const stat = fs.statSync(filePath)

        // Skip files older than 10 minutes (not related to current session)
        if (Date.now() - stat.mtimeMs > 10 * 60 * 1000) {
          s.staleFiles.add(file)
          continue
        }

        const prevSize = s.filePositions.get(file) ?? 0
        if (stat.size <= prevSize) continue  // No new content

        // Update tracked position
        s.filePositions.set(file, stat.size)

        // Read the tail of the file for latest activity
        const tail = readFileTail(filePath, 8192)
        const activity = extractLatestActivity(tail)
        if (!activity) continue

        const childSessionId = file.replace('.jsonl', '')

        // Try to match this file to a subagent
        let matched = s.sessionToAgent.get(file)
        if (!matched) {
          const firstPrompt = extractFirstPrompt(filePath)
          if (firstPrompt) {
            const target = matchToTarget(firstPrompt, s.targets)
            if (target) {
              matched = { name: target.name, taskId: target.taskId }
              s.sessionToAgent.set(file, matched)
            }
          }
        }

        activities.push({
          matchedName: matched?.name,
          matchedTaskId: matched?.taskId,
          childSessionId,
          latestTool: activity.tool,
          latestStatus: activity.status
        })
      } catch { /* skip individual file errors */ }
    }

    if (activities.length > 0) {
      _getWindow()?.webContents.send('claude-session:subagent-activity', {
        conversationId: s.conversationId,
        activities
      })
    }
  } catch (err) {
    console.error('[zeus] Subagent watcher error:', err)
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function startSubagentWatch(
  conversationId: string,
  parentSessionId: string,
  workspacePath: string,
  targets: SubagentWatchTarget[]
): boolean {
  stopSubagentWatch()

  const projectDir = findProjectDir(parentSessionId, workspacePath)
  if (!projectDir) {
    console.warn('[zeus] Subagent watcher: project dir not found for', workspacePath)
    return false
  }

  console.log(`[zeus] Subagent watcher started — dir: ${projectDir}, targets: ${targets.map(t => t.name).join(', ')}`)

  _state = {
    conversationId,
    parentSessionId,
    projectDir,
    targets,
    filePositions: new Map(),
    sessionToAgent: new Map(),
    staleFiles: new Set(),
    intervalId: setInterval(poll, 2000)
  }

  // Initial poll
  setTimeout(poll, 500)
  return true
}

export function updateSubagentTargets(targets: SubagentWatchTarget[]): void {
  if (_state) {
    _state.targets = targets
    // Clear stale match cache if new targets added
    // (a previously unmatched file might now match)
  }
}

export function stopSubagentWatch(): void {
  if (_state) {
    clearInterval(_state.intervalId)
    console.log(`[zeus] Subagent watcher stopped for ${_state.conversationId}`)
    _state = null
  }
}
