/**
 * Shared agent color and name utilities.
 * Used by claude-session store, ConversationView, and SkillsPanel.
 * Single source of truth — eliminates 80+ lines of duplication.
 */
import type { CustomSkill } from '../types/index.js'

// ── Color Map ──────────────────────────────────────────────────────────────────

/** Named color keywords → hex (matches Claude Code's agent color palette) */
export const AGENT_COLOR_MAP: Record<string, string> = {
  blue: '#61afef',
  purple: '#c678dd',
  green: '#98c379',
  yellow: '#e5c07b',
  cyan: '#56b6c2',
  orange: '#d19a66',
  red: '#e06c75',
  pink: '#e06c95',
  magenta: '#c678dd',
  teal: '#56b6c2',
  lime: '#a9dc76',
  indigo: '#7c8cf5',
  brown: '#be5046',
  white: '#abb2bf',
  gray: '#7f848e',
  grey: '#7f848e',
}

/** Deduplicated palette for hash-based fallback */
const PALETTE = Object.values(AGENT_COLOR_MAP).filter((v, i, a) => a.indexOf(v) === i)

// ── Color Resolution ───────────────────────────────────────────────────────────

/** Resolve a named color keyword (e.g. "purple") to hex. Returns null if unknown. */
export function resolveColorKeyword(keyword: string): string | null {
  return AGENT_COLOR_MAP[keyword.toLowerCase()] ?? null
}

/** Deterministic hash-based color from a string name */
export function colorForName(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0
  }
  return PALETTE[Math.abs(hash) % PALETTE.length]
}

/**
 * Look up an agent's defined color from customSkills (parsed from .md frontmatter).
 * Returns hex color or null if not found.
 */
export function lookupAgentColor(agentName: string, customSkills: CustomSkill[]): string | null {
  const normalized = agentName.toLowerCase().replace(/-/g, '_')
  for (const skill of customSkills) {
    if (skill.kind !== 'agent') continue
    const skillNorm = skill.name.toLowerCase().replace(/-/g, '_')
    if (skillNorm === normalized || skillNorm.endsWith(normalized) || normalized.endsWith(skillNorm)) {
      if (skill.color) return resolveColorKeyword(skill.color) ?? skill.color
    }
  }
  return null
}

/** Resolve color for a subagent: agent-defined → hash-based fallback */
export function resolveAgentColor(agentName: string, customSkills: CustomSkill[]): string {
  return lookupAgentColor(agentName, customSkills) ?? colorForName(agentName)
}

// ── Tool Identification ────────────────────────────────────────────────────────

/** Check if a tool name is a subagent Task */
export function isSubagentTool(name: string): boolean {
  return name === 'Task' || name.startsWith('dispatch_agent') || name === 'Agents'
}

// ── Name Extraction ────────────────────────────────────────────────────────────

/** Extract a human-readable agent name from the tool name and/or input */
export function extractSubagentName(toolName: string, input: Record<string, unknown>): string {
  // dispatch_agent_frontend_architect → "frontend-architect"
  if (toolName.startsWith('dispatch_agent_')) {
    return toolName.slice('dispatch_agent_'.length).replace(/_/g, '-')
  }
  // Agents tool — input may carry agent_name or name
  if (typeof input.agent_name === 'string' && input.agent_name) {
    return input.agent_name.replace(/_/g, '-')
  }
  if (typeof input.name === 'string' && input.name) {
    return input.name.replace(/_/g, '-')
  }
  // Task tool — try to derive a short name from description/prompt
  const desc = (typeof input.description === 'string' && input.description)
    || (typeof input.prompt === 'string' && input.prompt)
    || (typeof input.task_description === 'string' && input.task_description as string)
    || ''
  if (desc) {
    const nameMatch = desc.match(/^([a-z][a-z0-9_-]{2,30})(?:\s|:|$)/i)
    if (nameMatch) return nameMatch[1].toLowerCase().replace(/_/g, '-')
    const words = desc.split(/\s+/).slice(0, 3).join(' ')
    return words.length > 30 ? words.slice(0, 30) + '…' : words
  }
  return 'Subagent'
}

/** Extract subagent description from tool input */
export function extractSubagentDesc(input: Record<string, unknown>): string {
  if (typeof input.description === 'string' && input.description) return input.description
  if (typeof input.prompt === 'string' && input.prompt) {
    return input.prompt.length > 80 ? input.prompt.slice(0, 80) + '…' : input.prompt
  }
  if (typeof input.task_description === 'string') return input.task_description
  return 'Subagent'
}
