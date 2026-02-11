/**
 * App Store — persistent state management for Zeus.
 * Handles workspace list, window bounds, saved sessions, and IDE preferences.
 */
import path from 'node:path'
import fs from 'node:fs'
import { app } from 'electron'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface Workspace {
  path: string
  name: string
  addedAt: number
  lastOpened: number
}

export interface SavedSession {
  sessionId: string
  title: string
  workspacePath: string
  lastUsed: number
}

export interface AppStore {
  workspaces: Workspace[]
  lastWorkspace: string | null
  idePreference: string
  windowBounds: { x?: number; y?: number; width: number; height: number } | null
  savedSessions?: SavedSession[]
}

export interface IDEDef {
  id: string
  name: string
  cmd: string
  icon: string
}

// ── State ──────────────────────────────────────────────────────────────────────

const storeFilePath = path.join(app.getPath('userData'), 'zeus-store.json')

let _store: AppStore

let _saveTimer: ReturnType<typeof setTimeout> | null = null
let _savePending = false

// ── Public API ─────────────────────────────────────────────────────────────────

/** Get the current store (call after initStore) */
export function getStore(): AppStore {
  return _store
}

/** Load store from disk (call once on startup) */
export function initStore(): AppStore {
  try {
    if (fs.existsSync(storeFilePath)) {
      _store = JSON.parse(fs.readFileSync(storeFilePath, 'utf-8'))
      return _store
    }
  } catch {
    /* corrupted store — reset */
  }
  _store = { workspaces: [], lastWorkspace: null, idePreference: 'code', windowBounds: null }
  return _store
}

/** Debounced save — coalesces rapid writes into one disk write per 500ms */
export function saveStore(): void {
  _savePending = true
  if (_saveTimer) return
  _saveTimer = setTimeout(() => {
    _saveTimer = null
    if (!_savePending) return
    _savePending = false
    try {
      fs.mkdirSync(path.dirname(storeFilePath), { recursive: true })
      fs.writeFileSync(storeFilePath, JSON.stringify(_store, null, 2), 'utf-8')
    } catch (e) {
      console.error('[zeus] Failed to save store:', e)
    }
  }, 500)
}

/** Immediately flush any pending save (call on quit) */
export function flushStore(): void {
  if (_saveTimer) {
    clearTimeout(_saveTimer)
    _saveTimer = null
  }
  if (_savePending) {
    _savePending = false
    try {
      fs.mkdirSync(path.dirname(storeFilePath), { recursive: true })
      fs.writeFileSync(storeFilePath, JSON.stringify(_store, null, 2), 'utf-8')
    } catch (e) {
      console.error('[zeus] Failed to flush store:', e)
    }
  }
}
