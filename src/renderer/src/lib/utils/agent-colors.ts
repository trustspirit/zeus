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

/** Normalised set of subagent tool names (lowercase for case-insensitive match) */
const SUBAGENT_TOOLS = new Set(['task', 'delegate_task', 'agents'])

/** Tools used to retrieve or cancel background subagent results */
const SUBAGENT_AUX_TOOLS = new Set([
  'taskoutput', 'background_output',
  'taskcancel', 'background_cancel'
])

/** Check if a tool name is a subagent/task tool (one that STARTS a subagent) */
export function isSubagentTool(name: string): boolean {
  const lower = name.toLowerCase()
  return SUBAGENT_TOOLS.has(lower) || lower.startsWith('dispatch_agent')
}

/** Check if a tool is subagent-auxiliary (TaskOutput, background_output, etc.) */
export function isSubagentAuxTool(name: string): boolean {
  return SUBAGENT_AUX_TOOLS.has(name.toLowerCase())
}

/**
 * Human-readable label for a subagent auxiliary tool.
 * When subagents are provided, resolves task_id to a human-readable name.
 */
export function subagentAuxLabel(
  name: string,
  input: Record<string, unknown>,
  subagents?: { taskId?: string; name: string; nestedStatus?: string; finished?: boolean }[]
): string {
  const lower = name.toLowerCase()
  if (lower === 'taskoutput' || lower === 'background_output') {
    const taskId = typeof input.task_id === 'string' ? input.task_id : ''
    const blocking = input.block === true

    // Try to resolve task_id to a known subagent name
    let agentLabel = ''
    let lastActivity = ''
    if (taskId && subagents) {
      const match = subagents.find((s) => s.taskId === taskId)
      if (match) {
        agentLabel = match.name
        lastActivity = match.nestedStatus || ''
      }
    }
    // Fallback: if only one active (unfinished) subagent, it's probably that one
    if (!agentLabel && subagents) {
      const active = subagents.filter((s) => !s.finished)
      if (active.length === 1) {
        agentLabel = active[0].name
        lastActivity = active[0].nestedStatus || ''
      } else if (active.length > 1) {
        // Multiple agents: try the most recently started (last in array) that doesn't have a result yet
        const candidate = active[active.length - 1]
        agentLabel = candidate.name
        lastActivity = candidate.nestedStatus || ''
      }
    }

    // Human-readable label — never show raw hash to users
    const label = agentLabel || 'agent'
    const activity = lastActivity && !UNINFORMATIVE_STATUSES.has(lastActivity)
      ? ` — ${lastActivity}`
      : ''

    return blocking
      ? `Waiting for ${label}${activity}`
      : `Checking ${label} status${activity}`
  }
  if (lower === 'taskcancel' || lower === 'background_cancel') {
    return input.all === true ? 'Cancelling all background tasks…' : 'Cancelling background task…'
  }
  return name
}

/** Statuses that are too generic to display as "activity" context */
const UNINFORMATIVE_STATUSES = new Set([
  'Executing…', 'Starting…', 'Working…', 'Processing…', 'Preparing…'
])

/**
 * Build a summary string describing what all active subagents are doing.
 * Used to replace the vague "Processing…" status.
 */
export function buildSubagentSummary(
  subagents: { name: string; nestedStatus?: string; finished?: boolean }[]
): string {
  const active = subagents.filter((s) => !s.finished)
  if (active.length === 0) return ''

  // Collect informative statuses
  const details = active
    .map((s) => {
      const status = s.nestedStatus || ''
      if (!status || UNINFORMATIVE_STATUSES.has(status)) return null
      return `${s.name}: ${status}`
    })
    .filter(Boolean)

  if (details.length > 0) return details[0]!
  // All agents running but no specific activity — show agent count
  if (active.length === 1) return `${active[0].name} working…`
  return `${active.length} agents working…`
}

// ── Name Extraction ────────────────────────────────────────────────────────────

/** Extract a human-readable agent name from the tool name and/or input */
export function extractSubagentName(toolName: string, input: Record<string, unknown>): string {
  const lower = toolName.toLowerCase()

  // dispatch_agent_frontend_architect → "frontend-architect"
  if (lower.startsWith('dispatch_agent_')) {
    return toolName.slice('dispatch_agent_'.length).replace(/_/g, '-')
  }

  // subagent_type is the primary agent role identifier (e.g. "explore", "frontend-ui-ux-engineer")
  if (typeof input.subagent_type === 'string' && input.subagent_type) {
    return input.subagent_type.replace(/_/g, '-')
  }

  // Agents tool — input may carry agent_name or name
  if (typeof input.agent_name === 'string' && input.agent_name) {
    return input.agent_name.replace(/_/g, '-')
  }
  if (typeof input.name === 'string' && input.name) {
    return input.name.replace(/_/g, '-')
  }

  // category field (delegate_task uses this, e.g. "quick")
  if (typeof input.category === 'string' && input.category) {
    return input.category.replace(/_/g, '-')
  }

  return ''
}

/** Extract subagent description from tool input */
export function extractSubagentDesc(input: Record<string, unknown>): string {
  if (typeof input.description === 'string' && input.description) return input.description
  if (typeof input.prompt === 'string' && input.prompt) {
    return input.prompt.length > 120 ? input.prompt.slice(0, 120) + '…' : input.prompt
  }
  if (typeof input.task_description === 'string') return input.task_description
  return ''
}
