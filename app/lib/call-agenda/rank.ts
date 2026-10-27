/**
 * Call agenda ranking (pure, deterministic). Inputs: a crew's open tasks and the
 * previous published call's action items. Output: 3-7 short bullets, most urgent
 * first. No AI: the wording is templated so the same data always gives the same post.
 */
import type { CrewTaskDetail } from '@/app/lib/crew-mappings'

export const MAX_BULLETS = 7
const MAX_TASKS = 5
const MAX_FOLLOWUPS = 2
const MAX_LEN = 110

export interface ActionItem {
  text: string
  owner?: string | null
}

export type AgendaKind = 'overdue' | 'priority' | 'active' | 'followup'

export interface AgendaBullet {
  kind: AgendaKind
  text: string
  url?: string
}

const DAY_MS = 24 * 60 * 60 * 1000

function clip(s: string): string {
  const t = s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  return t.length > MAX_LEN ? `${t.slice(0, MAX_LEN - 1).trimEnd()}…` : t
}

function priorityRank(p?: string): number {
  const l = (p ?? '').toLowerCase()
  if (l.includes('top') || l === '0') return 0
  if (l.includes('high') || l === '1') return 1
  if (l.includes('mid') || l === '2') return 2
  if (l.includes('low') || l === '3') return 3
  return 4
}

/** Whole days a task is overdue at `now` (UTC dates), 0 when not overdue or no due date. */
export function daysOverdue(due: string | undefined, now: Date): number {
  if (!due) return 0
  const t = Date.parse(`${due}T00:00:00Z`)
  if (Number.isNaN(t)) return 0
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Math.max(0, Math.floor((today - t) / DAY_MS))
}

/** Parse the JSON `actionItems` column defensively (strings or {text, owner}). */
export function parseActionItems(raw: unknown): ActionItem[] {
  if (!Array.isArray(raw)) return []
  const out: ActionItem[] = []
  for (const it of raw) {
    if (typeof it === 'string' && it.trim()) out.push({ text: it })
    else if (it && typeof it === 'object' && typeof (it as ActionItem).text === 'string' && (it as ActionItem).text.trim()) {
      const o = (it as ActionItem).owner
      out.push({ text: (it as ActionItem).text, owner: typeof o === 'string' && o.trim() ? o : null })
    }
  }
  return out
}

export function buildAgendaBullets(input: {
  tasks: readonly CrewTaskDetail[]
  actionItems?: readonly ActionItem[]
  now: Date
}): AgendaBullet[] {
  const { now } = input
  type Scored = { t: CrewTaskDetail; overdue: number; pr: number }
  const scored: Scored[] = input.tasks.map((t) => ({ t, overdue: daysOverdue(t.due, now), pr: priorityRank(t.priority) }))
  // Urgent = overdue, or Top/High priority. Others only pad the list if actively in progress.
  const urgent = scored
    .filter((s) => s.overdue > 0 || s.pr <= 1)
    .sort(
      (a, b) =>
        Number(b.overdue > 0) - Number(a.overdue > 0) ||
        b.overdue - a.overdue ||
        a.pr - b.pr ||
        Number(b.t.isActive) - Number(a.t.isActive) ||
        a.t.label.localeCompare(b.t.label),
    )
    .slice(0, MAX_TASKS)
  const bullets: AgendaBullet[] = []
  const seen = new Set<string>()
  const add = (b: AgendaBullet) => {
    const key = b.text.toLowerCase()
    if (seen.has(key) || bullets.length >= MAX_BULLETS) return
    seen.add(key)
    bullets.push(b)
  }

  for (const s of urgent) {
    const label = clip(s.t.label)
    if (s.overdue > 0) add({ kind: 'overdue', text: `Overdue ${s.overdue}d: ${label}`, url: s.t.url })
    else add({ kind: 'priority', text: `${s.pr === 0 ? 'Top' : 'High'} priority: ${label}`, url: s.t.url })
  }
  for (const a of (input.actionItems ?? []).slice(0, MAX_FOLLOWUPS)) {
    add({ kind: 'followup', text: `From last call: ${clip(a.text)}${a.owner ? ` (${clip(a.owner).slice(0, 40)})` : ''}` })
  }
  // Pad toward 3 with in-progress tasks (highest priority first).
  if (bullets.length < 3) {
    const used = new Set(urgent)
    const rest = scored
      .filter((s) => !used.has(s) && s.t.isActive)
      .sort((a, b) => a.pr - b.pr || a.t.label.localeCompare(b.t.label))
    for (const s of rest) {
      if (bullets.length >= 3) break
      add({ kind: 'active', text: `In progress: ${clip(s.t.label)}`, url: s.t.url })
    }
  }
  return bullets
}

/** The Discord message: bullets, then the crew-page link. */
export function formatAgendaMessage(o: { crewLabel: string; startsAt: Date; bullets: readonly AgendaBullet[]; crewUrl: string }): string {
  const ts = Math.floor(o.startsAt.getTime() / 1000)
  const lines = [`**${o.crewLabel} call agenda** (starts <t:${ts}:R>)`, ...o.bullets.map((b) => `- ${b.text}`), `Crew page: ${o.crewUrl}`]
  return lines.join('\n')
}
