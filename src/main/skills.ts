/**
 * Custom skills scanner — discovers .md files from .claude/{commands,skills,agents}/.
 */
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

// ── Shared constants ──────────────────────────────────────────────────────────

/** Directories to skip during recursive scanning */
export const SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out',
  '.next', '.nuxt', '.output', '__pycache__', 'venv', '.venv',
  'target', 'vendor', '.idea', '.vscode', 'coverage', '.cache', '.turbo'
])

// ── Types ──────────────────────────────────────────────────────────────────────

export type SkillKind = 'command' | 'skill' | 'agent'

export interface CustomSkillEntry {
  name: string
  filename: string
  filePath: string
  scope: 'user' | 'project'
  kind: SkillKind
  relativeTo: string
  content: string
  subdir: string
  color?: string
  metaDescription?: string
}

// ── Frontmatter Parser ─────────────────────────────────────────────────────────

/** Parse YAML frontmatter from a markdown file and return { meta, body } */
export function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const meta: Record<string, string> = {}
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!match) return { meta, body: raw }

  const yamlBlock = match[1]
  const body = raw.slice(match[0].length)

  for (const line of yamlBlock.split('\n')) {
    const kv = line.match(/^(\w[\w-]*):\s*(.+)$/)
    if (kv) {
      meta[kv[1].trim()] = kv[2].trim()
    }
  }
  return { meta, body }
}

// ── Scanner ────────────────────────────────────────────────────────────────────

const SKILL_DIRS: { dir: string; kind: SkillKind }[] = [
  { dir: 'commands', kind: 'command' },
  { dir: 'skills', kind: 'skill' },
  { dir: 'agents', kind: 'agent' }
]

/**
 * Scan for custom skills (.md files) from:
 * 1. Global: ~/.claude/{commands,skills,agents}/
 * 2. Project root: <wsPath>/.claude/{commands,skills,agents}/
 * 3. Child directories (depth-limited): <wsPath>/<child>/.claude/{commands,skills,agents}/
 */
export function scanCustomSkills(wsPath: string): CustomSkillEntry[] {
  const results: CustomSkillEntry[] = []

  // 1. Global user commands/skills/agents
  for (const { dir, kind } of SKILL_DIRS) {
    const globalDir = path.join(os.homedir(), '.claude', dir)
    collectCommandFiles(globalDir, 'user', kind, os.homedir(), results)
  }

  // 2 & 3: Project commands
  if (wsPath && fs.existsSync(wsPath)) {
    for (const { dir, kind } of SKILL_DIRS) {
      const projectDir = path.join(wsPath, '.claude', dir)
      collectCommandFiles(projectDir, 'project', kind, wsPath, results)
    }
    scanChildrenForCommands(wsPath, results, 0)
  }

  return results
}

function collectCommandFiles(
  cmdsDir: string,
  scope: 'user' | 'project',
  kind: SkillKind,
  relativeTo: string,
  results: CustomSkillEntry[]
): void {
  collectRecursive(cmdsDir, cmdsDir, scope, kind, relativeTo, results, 0)
}

function collectRecursive(
  baseDir: string,
  currentDir: string,
  scope: 'user' | 'project',
  kind: SkillKind,
  relativeTo: string,
  results: CustomSkillEntry[],
  depth: number
): void {
  if (depth > 5) return
  try {
    if (!fs.existsSync(currentDir) || !fs.statSync(currentDir).isDirectory()) return
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name)

      if (entry.isFile() && /\.md$/i.test(entry.name)) {
        if (results.some((r) => r.filePath === fullPath)) continue

        const relFromBase = path.relative(baseDir, fullPath)
        const nameWithoutExt = relFromBase.replace(/\.md$/i, '')
        const colonName = nameWithoutExt.split(path.sep).join(':')
        const dirParts = nameWithoutExt.split(path.sep)
        const subdir = dirParts.length > 1 ? dirParts.slice(0, -1).join('/') : ''

        try {
          const raw = fs.readFileSync(fullPath, 'utf-8')
          const { meta, body } = parseFrontmatter(raw)

          results.push({
            name: meta.name || colonName,
            filename: entry.name,
            filePath: fullPath,
            scope,
            kind,
            relativeTo,
            content: (body || raw).slice(0, 200),
            subdir,
            color: meta.color || undefined,
            metaDescription: meta.description || undefined
          })
        } catch { /* unreadable file */ }
      } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
        collectRecursive(baseDir, fullPath, scope, kind, relativeTo, results, depth + 1)
      }
    }
  } catch { /* directory access error */ }
}

function scanChildrenForCommands(dir: string, results: CustomSkillEntry[], depth: number): void {
  if (depth > 3) return
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.') && entry.name !== '.claude') continue
      if (SKIP_DIRS.has(entry.name)) continue

      const childPath = path.join(dir, entry.name)

      for (const { dir: subDir, kind } of SKILL_DIRS) {
        const cmdsDir = path.join(childPath, '.claude', subDir)
        if (fs.existsSync(cmdsDir)) {
          collectCommandFiles(cmdsDir, 'project', kind, childPath, results)
        }
      }

      scanChildrenForCommands(childPath, results, depth + 1)
    }
  } catch { /* permission error */ }
}
