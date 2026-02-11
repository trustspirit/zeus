/**
 * Claude Code sessions — spawned in a PTY for full interactive terminal support.
 *
 * Uses node-pty so Claude Code runs in a real pseudo-terminal, exactly like the
 * CLI. This means permissions, prompts, input requests, and all interactive
 * features work natively — we just parse the stream-json output and relay it.
 */
import os from 'node:os'
import fs from 'node:fs'
import type { BrowserWindow } from 'electron'
import type * as PtyModule from 'node-pty'
import { getClaudeCliPath, getShellEnv } from './claude-cli.js'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ClaudeSessionEntry {
  pty: PtyModule.IPty | null
  sessionId: string | null
  cwd: string
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
let _pty: typeof PtyModule
const sessions = new Map<string, ClaudeSessionEntry>()

// ── Init ───────────────────────────────────────────────────────────────────────

/** Initialise the session module. Call once on startup, passing the pty module. */
export function initClaudeSession(
  ptyModule: typeof PtyModule,
  getWindow: () => BrowserWindow | null
): void {
  _pty = ptyModule
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
// In PTY mode, stdout + stderr are mixed. We detect prompts from non-JSON lines.

export function detectPrompt(text: string): DetectedPrompt | null {
  const clean = text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim()
  if (!clean || clean.length < 5) return null

  // ── Permission: "Allow Tool(args)? (y/n/a)" ──
  const permissionPatterns = [
    /(?:Allow|Approve)\s+(\w+)\(([^)]+)\)\s*\?\s*\(([yYnNaA/\s]+)\)/,
    /(?:Allow|Do you want to allow|Approve)\s+(.+?)\s*\?\s*\(([yYnNaA][^)]*)\)/,
    /(.+?)\s*\(([yYnNaA][/|][yYnNaA](?:[/|][yYnNaA])?)\)\s*$/
  ]

  for (const pattern of permissionPatterns) {
    const m = clean.match(pattern)
    if (!m) continue
    const options: DetectedPrompt['options'] = []
    const optStr = (m[3] || m[2] || '').toLowerCase()
    if (optStr.includes('y')) options.push({ label: 'Yes', value: 'y', key: 'y' })
    if (optStr.includes('n')) options.push({ label: 'No', value: 'n', key: 'n' })
    if (optStr.includes('a')) options.push({ label: 'Always allow', value: 'a', key: 'a' })
    if (options.length === 0) continue

    let toolName: string | undefined
    let toolInput: string | undefined
    if (m[3]) { toolName = m[1]; toolInput = m[2] }
    else {
      const tp = (m[1] || '').match(/(\w+)\((.+)\)/)
      if (tp) { toolName = tp[1]; toolInput = tp[2] }
    }
    return { promptType: 'permission', message: clean, options, toolName, toolInput }
  }

  // ── Numbered choices ──
  const numberedLines = clean.match(/^\s*(\d+)[.)]\s+.+$/gm)
  if (numberedLines && numberedLines.length >= 2) {
    const lastLine = numberedLines[numberedLines.length - 1]
    const afterLast = clean.slice(clean.lastIndexOf(lastLine) + lastLine.length).trim()
    if (afterLast.length < 30) {
      const options: DetectedPrompt['options'] = []
      for (const line of numberedLines) {
        const m = line.match(/^\s*(\d+)[.)]\s+(.+)$/)
        if (m) options.push({ label: m[2].trim(), value: m[1], key: m[1] })
      }
      if (options.length >= 2 && options.length <= 10) {
        const firstIdx = clean.indexOf(numberedLines[0])
        return { promptType: 'choice', message: firstIdx > 0 ? clean.slice(0, firstIdx).trim() : 'Choose an option', options }
      }
    }
  }

  // ── Generic yes/no: "... (y/n)" ──
  const ynMatch = clean.match(/(.+?)\s*[\[(]([yYnN][/|][yYnN])[\])]\s*$/)
  if (ynMatch) {
    return { promptType: 'yesno', message: ynMatch[1].trim(), options: [{ label: 'Yes', value: 'y', key: 'y' }, { label: 'No', value: 'n', key: 'n' }] }
  }

  // ── Waiting for input: "? ..." ──
  const inputMatch = clean.match(/^\?\s+(.+?):\s*$/)
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
    session = { pty: null, sessionId: null, cwd }
    sessions.set(conversationId, session)
  }

  if (resumeSessionId && !session.sessionId) {
    session.sessionId = resumeSessionId
  }

  // Kill any still-running PTY for this conversation
  if (session.pty) {
    try { session.pty.kill() } catch { /* ignore */ }
    session.pty = null
  }

  const claudePath = getClaudeCliPath()
  const safePrompt = prompt.startsWith('-') ? '\n' + prompt : prompt
  const args = [
    '-p', safePrompt,
    '--output-format', 'stream-json',
    '--verbose',
  ]

  if (model) args.push('--model', model)
  if (session.sessionId) args.push('--resume', session.sessionId, '--continue')

  const effectiveCwd = cwd && fs.existsSync(cwd) ? cwd : os.homedir()

  console.log(`[zeus] Spawning Claude PTY session ${conversationId}:`, claudePath, args.map((a, i) => i === 1 ? `"${a.slice(0, 60)}..."` : a).join(' '))
  console.log(`[zeus] CWD: ${effectiveCwd}`)

  const env = {
    ...getShellEnv(),
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    LANG: process.env.LANG || 'en_US.UTF-8'
  }

  try {
    const ptyProcess = _pty.spawn(claudePath, args, {
      name: 'xterm-256color',
      cols: 200,  // Wide so tool output doesn't wrap
      rows: 50,
      cwd: effectiveCwd,
      env
    })

    session.pty = ptyProcess
    console.log(`[zeus] Claude PTY PID: ${ptyProcess.pid}`)

    // ── Parse combined PTY output ──
    // In a PTY, stdout + stderr are merged. We parse line-by-line:
    // - Valid JSON → stream-json event
    // - Non-JSON text → check for prompts or relay as raw
    let buffer = ''
    let nonJsonBuf = ''
    let nonJsonTimer: ReturnType<typeof setTimeout> | null = null

    const flushNonJson = (): void => {
      if (!nonJsonBuf.trim()) { nonJsonBuf = ''; return }
      const text = nonJsonBuf
      nonJsonBuf = ''

      // Try to detect interactive prompts
      const prompt = detectPrompt(text)
      if (prompt) {
        console.log(`[zeus] PTY prompt detected: type=${prompt.promptType}, options=${prompt.options.map(o => o.label).join(',')}`)
        _getWindow()?.webContents.send('claude-session:event', {
          id: conversationId,
          event: { type: 'prompt', ...prompt, rawText: text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim() }
        })
      } else {
        // Relay as raw stderr-like text (ANSI stripped for display)
        const clean = text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim()
        if (clean) {
          _getWindow()?.webContents.send('claude-session:event', {
            id: conversationId,
            event: { type: 'stderr', text }
          })
        }
      }
    }

    ptyProcess.onData((data: string) => {
      buffer += data

      // Split into lines — keep incomplete last line in buffer
      const lines = buffer.split('\n')
      buffer = lines.pop()!

      for (const line of lines) {
        const trimmed = line.replace(/\r$/, '').trim()
        if (!trimmed) continue

        // Try JSON parse first
        try {
          const event = JSON.parse(trimmed)
          // Flush any pending non-JSON before processing this event
          if (nonJsonBuf.trim()) {
            if (nonJsonTimer) { clearTimeout(nonJsonTimer); nonJsonTimer = null }
            flushNonJson()
          }
          // Capture session_id
          if (event.sessionId || event.session_id) {
            session!.sessionId = event.sessionId || event.session_id
          }
          _getWindow()?.webContents.send('claude-session:event', { id: conversationId, event })
        } catch {
          // Not JSON — accumulate for prompt detection
          nonJsonBuf += line + '\n'
          if (nonJsonTimer) clearTimeout(nonJsonTimer)
          nonJsonTimer = setTimeout(flushNonJson, 300)
        }
      }
    })

    ptyProcess.onExit(({ exitCode }) => {
      console.log(`[zeus] Claude PTY closed [${conversationId}] exit=${exitCode}`)

      // Flush remaining buffer
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer.trim())
          if (event.sessionId || event.session_id) {
            session!.sessionId = event.sessionId || event.session_id
          }
          _getWindow()?.webContents.send('claude-session:event', { id: conversationId, event })
        } catch {
          nonJsonBuf += buffer
          flushNonJson()
        }
      }
      // Flush non-JSON
      if (nonJsonTimer) { clearTimeout(nonJsonTimer); nonJsonTimer = null }
      flushNonJson()

      session!.pty = null

      _getWindow()?.webContents.send('claude-session:done', {
        id: conversationId,
        exitCode: exitCode ?? 0,
        sessionId: session!.sessionId
      })
    })

    return true
  } catch (err) {
    console.error(`[zeus] Claude PTY spawn error [${conversationId}]:`, (err as Error).message)
    _getWindow()?.webContents.send('claude-session:event', {
      id: conversationId,
      event: { type: 'error', text: (err as Error).message }
    })
    _getWindow()?.webContents.send('claude-session:done', {
      id: conversationId,
      exitCode: 1,
      sessionId: session!.sessionId
    })
    return false
  }
}

// ── Respond to Prompt ──────────────────────────────────────────────────────────

/** Write a response to the PTY's stdin. Always available (no stdinReady needed). */
export function respondToSession(conversationId: string, response: string): boolean {
  const session = sessions.get(conversationId)
  if (!session?.pty) {
    console.warn(`[zeus] respondToSession: no active PTY for ${conversationId}`)
    return false
  }
  console.log(`[zeus] Responding to PTY [${conversationId}]: "${response}"`)
  session.pty.write(response + '\n')
  return true
}

// ── Abort ────────────────────────────────────────────────────────────────────

/** Send SIGINT (Ctrl-C) to the PTY to abort the current operation. */
export function abortSession(conversationId: string): boolean {
  const session = sessions.get(conversationId)
  if (!session?.pty) return false
  // Send Ctrl-C character
  session.pty.write('\x03')
  return true
}

// ── Kill All ─────────────────────────────────────────────────────────────────

/** Kill all active Claude sessions (call on app quit) */
export function killAllClaudeSessions(): void {
  for (const [, s] of sessions) {
    if (s.pty) {
      try { s.pty.kill() } catch { /* ignore */ }
      s.pty = null
    }
  }
  sessions.clear()
}
