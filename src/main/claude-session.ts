/**
 * Claude Code headless sessions — spawning, stdin management, and prompt detection.
 */
import os from 'node:os'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import type { BrowserWindow } from 'electron'
import { getClaudeCliPath } from './claude-cli.js'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ClaudeSessionEntry {
  process: ReturnType<typeof spawn> | null
  sessionId: string | null
  cwd: string
  /** Whether stdin is still open and writable for prompt responses */
  stdinReady: boolean
}

export interface DetectedPrompt {
  promptType: 'permission' | 'yesno' | 'choice' | 'input'
  message: string
  options: { label: string; value: string; key?: string }[]
  toolName?: string
  toolInput?: string
}

// ── State ──────────────────────────────────────────────────────────────────────

let _getWindow: () => BrowserWindow | null = () => null
const sessions = new Map<string, ClaudeSessionEntry>()

// ── Init ───────────────────────────────────────────────────────────────────────

/** Initialise the session module. Call once on startup. */
export function initClaudeSession(getWindow: () => BrowserWindow | null): void {
  _getWindow = getWindow
}

// ── Session Map Access ─────────────────────────────────────────────────────────

export function getSession(id: string): ClaudeSessionEntry | undefined {
  return sessions.get(id)
}

export function deleteSession(id: string): void {
  sessions.delete(id)
}

// ── Prompt Detection ─────────────────────────────────────────────────────────
// Detect permission prompts and option requests from Claude Code's stderr output.

export function detectPrompt(text: string): DetectedPrompt | null {
  // ── Permission: "Allow <tool>? (y)es / (n)o / (a)lways / ..." ──
  const permissionMatch = text.match(
    /(?:\?\s*)?(?:Allow|Do you want to allow|Approve)\s+(.+?)(?:\s*\?\s*|\s+)?\(([ynaYNA/\s]+)\)/i
  )
  if (permissionMatch) {
    const toolDesc = permissionMatch[1].trim()
    const optStr = permissionMatch[2].toLowerCase()
    const options: DetectedPrompt['options'] = []
    if (optStr.includes('y')) options.push({ label: 'Yes', value: 'y', key: 'y' })
    if (optStr.includes('n')) options.push({ label: 'No', value: 'n', key: 'n' })
    if (optStr.includes('a')) options.push({ label: 'Always', value: 'a', key: 'a' })
    const toolParts = toolDesc.match(/^(\w+)\((.+)\)$/)
    return {
      promptType: 'permission',
      message: text,
      options: options.length > 0 ? options : [
        { label: 'Yes', value: 'y', key: 'y' },
        { label: 'No', value: 'n', key: 'n' }
      ],
      toolName: toolParts?.[1],
      toolInput: toolParts?.[2]
    }
  }

  // ── Permission: "Yes / No / Always allow" style (multi-line) ──
  const yesNoAlwaysMatch = text.match(
    /(?:Allow|Approve|accept|permit|trust)\b.+?(?:\n|.)*?(Yes|No|Always|Deny|Allow|Cancel)/i
  )
  if (yesNoAlwaysMatch && /\b(?:yes|no|always|deny|allow|cancel)\b/i.test(text)) {
    const options: DetectedPrompt['options'] = []
    if (/\byes\b/i.test(text)) options.push({ label: 'Yes', value: 'y', key: 'y' })
    if (/\bno\b/i.test(text)) options.push({ label: 'No', value: 'n', key: 'n' })
    if (/\balways\b/i.test(text)) options.push({ label: 'Always', value: 'a', key: 'a' })
    if (/\bdeny\b/i.test(text)) options.push({ label: 'Deny', value: 'n', key: 'n' })
    if (options.length >= 2) {
      return { promptType: 'yesno', message: text, options }
    }
  }

  // ── Numbered choices: "1) ...\n2) ...\n3) ..." or "1. ... 2. ..." ──
  const numberedLines = text.match(/^\s*(\d+)[.)]\s+.+$/gm)
  if (numberedLines && numberedLines.length >= 2) {
    const options: DetectedPrompt['options'] = []
    for (const line of numberedLines) {
      const m = line.match(/^\s*(\d+)[.)]\s+(.+)$/)
      if (m) {
        options.push({ label: m[2].trim(), value: m[1], key: m[1] })
      }
    }
    if (options.length >= 2) {
      const firstIdx = text.indexOf(numberedLines[0])
      const header = firstIdx > 0 ? text.slice(0, firstIdx).trim() : 'Choose an option'
      return {
        promptType: 'choice',
        message: header || 'Choose an option',
        options
      }
    }
  }

  // ── Generic yes/no: "... (y/n)" or "... [Y/n]" ──
  const ynMatch = text.match(/(.+?)\s*[\[(]([yYnN][/|][yYnN])[\])]\s*$/)
  if (ynMatch) {
    return {
      promptType: 'yesno',
      message: ynMatch[1].trim(),
      options: [
        { label: 'Yes', value: 'y', key: 'y' },
        { label: 'No', value: 'n', key: 'n' }
      ]
    }
  }

  // ── Waiting for input: "? ..." ending with ":" ──
  const inputMatch = text.match(/^\?\s+(.+?):\s*$/)
  if (inputMatch) {
    return { promptType: 'input', message: inputMatch[1].trim(), options: [] }
  }

  return null
}

// ── Session Spawning ─────────────────────────────────────────────────────────

export function spawnClaudeSession(
  conversationId: string,
  prompt: string,
  cwd: string,
  model?: string,
  resumeSessionId?: string
): boolean {
  let session = sessions.get(conversationId)
  if (!session) {
    session = { process: null, sessionId: null, cwd, stdinReady: false }
    sessions.set(conversationId, session)
  }

  if (resumeSessionId && !session.sessionId) {
    session.sessionId = resumeSessionId
  }

  // Kill any still-running process for this conversation
  if (session.process) {
    const oldProcess = session.process
    session.process = null
    try {
      oldProcess.kill('SIGINT')
      oldProcess.removeAllListeners()
    } catch { /* ignore */ }
  }

  const claudePath = getClaudeCliPath()
  const safePrompt = prompt.startsWith('-') ? '\n' + prompt : prompt
  const args = ['-p', safePrompt, '--output-format', 'stream-json', '--verbose', '--include-partial-messages']

  if (model) args.push('--model', model)
  if (session.sessionId) args.push('--resume', session.sessionId, '--continue')

  const effectiveCwd = cwd && fs.existsSync(cwd) ? cwd : os.homedir()

  console.log(`[zeus] Spawning Claude session ${conversationId}:`, claudePath, args.map((a, i) => i === 1 ? `"${a.slice(0, 60)}..."` : a).join(' '))
  console.log(`[zeus] CWD: ${effectiveCwd}`)

  const child = spawn(claudePath, args, {
    cwd: effectiveCwd,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      LANG: process.env.LANG || 'en_US.UTF-8'
    },
    stdio: ['pipe', 'pipe', 'pipe']
  })

  // Keep stdin open for interactive prompt responses
  session.stdinReady = true
  let gotOutput = false
  const stdinSafetyTimer = setTimeout(() => {
    if (!gotOutput && child.stdin && !child.stdin.destroyed) {
      console.log(`[zeus] No output after 5s [${conversationId}] — closing stdin as safety fallback`)
      try { child.stdin.end() } catch { /* ignore */ }
      session!.stdinReady = false
    }
  }, 5000)

  child.stdout?.once('data', () => {
    gotOutput = true
    clearTimeout(stdinSafetyTimer)
  })

  session.process = child
  console.log(`[zeus] Claude process PID: ${child.pid}`)

  let buffer = ''

  child.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString()
    buffer += text

    const lines = buffer.split('\n')
    buffer = lines.pop()! // keep incomplete last line

    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const event = JSON.parse(line)
        if (event.sessionId || event.session_id) {
          session!.sessionId = event.sessionId || event.session_id
        }
        _getWindow()?.webContents.send('claude-session:event', { id: conversationId, event })
      } catch {
        _getWindow()?.webContents.send('claude-session:event', {
          id: conversationId,
          event: { type: 'raw', text: line }
        })
      }
    }
  })

  // Accumulate stderr for multi-chunk prompt detection
  let stderrBuf = ''
  let stderrFlushTimer: ReturnType<typeof setTimeout> | null = null

  child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString()
    console.log(`[zeus] Claude stderr [${conversationId}]:`, text.slice(0, 300))

    stderrBuf += text

    if (stderrFlushTimer) clearTimeout(stderrFlushTimer)
    stderrFlushTimer = setTimeout(() => {
      const full = stderrBuf
      stderrBuf = ''
      const clean = full.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim()
      const prompt = detectPrompt(clean)
      if (prompt) {
        _getWindow()?.webContents.send('claude-session:event', {
          id: conversationId,
          event: { type: 'prompt', ...prompt, rawText: clean }
        })
      } else {
        _getWindow()?.webContents.send('claude-session:event', {
          id: conversationId,
          event: { type: 'stderr', text: full }
        })
      }
    }, 150)
  })

  child.on('close', (code) => {
    console.log(`[zeus] Claude process closed [${conversationId}] exit=${code}`)
    if (buffer.trim()) {
      try {
        const event = JSON.parse(buffer)
        if (event.sessionId || event.session_id) {
          session!.sessionId = event.sessionId || event.session_id
        }
        _getWindow()?.webContents.send('claude-session:event', { id: conversationId, event })
      } catch { /* ignore trailing junk */ }
    }

    session!.process = null
    session!.stdinReady = false

    _getWindow()?.webContents.send('claude-session:done', {
      id: conversationId,
      exitCode: code ?? 0,
      sessionId: session!.sessionId
    })
  })

  child.on('error', (err) => {
    console.error(`[zeus] Claude spawn error [${conversationId}]:`, err.message)
    _getWindow()?.webContents.send('claude-session:event', {
      id: conversationId,
      event: { type: 'error', text: err.message }
    })
    session!.process = null
    _getWindow()?.webContents.send('claude-session:done', {
      id: conversationId,
      exitCode: 1,
      sessionId: session!.sessionId
    })
  })

  return true
}

/** Kill all active Claude sessions (call on app quit) */
export function killAllClaudeSessions(): void {
  for (const [, s] of sessions) {
    if (s.process) {
      try {
        if (s.stdinReady && s.process.stdin && !s.process.stdin.destroyed) {
          s.process.stdin.end()
        }
        s.process.removeAllListeners()
        s.process.stdout?.removeAllListeners()
        s.process.stderr?.removeAllListeners()
        s.process.kill('SIGINT')
      } catch { /* ignore */ }
      s.process = null
      s.stdinReady = false
    }
  }
  sessions.clear()
}
