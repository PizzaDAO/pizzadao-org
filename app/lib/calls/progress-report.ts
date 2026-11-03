/**
 * /progress: last call's action items and where they stand, plus the crew's open tasks
 * (plans/metalhead-call-features.md, phase B). Reuses the pre-call agenda code: the action items
 * (`previousCallWithActionItems`), the task ranking (`buildAgendaBullets`) and the private
 * editorial post filter. Posted publicly in the channel it was asked in, so the same filter rules
 * as automated posts apply: an excluded crew gets no report, blocked terms are dropped, and a filter
 * that cannot be read means no report.
 *
 * Follow-up status is optional (calls.progressShowFollowups, default off): only an icon per item,
 * never the DM text or replies.
 *
 * Everything external is injected (ProgressDeps) so the builder is testable without Discord or a DB.
 */
import type { CrewOption, CrewTaskDetail } from '@/app/lib/crew-mappings'
import { normalizeCrewId } from '@/app/lib/crew-id'
import { resolveCrewForEvent } from '@/app/lib/calls/crew-map'
import { isCrewExcluded, mentionsBlockedTerm, type PostFilter } from '@/app/lib/calls/post-filters'
import { buildAgendaBullets, clipTo, type ActionItem, type AgendaBullet } from '@/app/lib/call-agenda/rank'

export interface ProgressSettings {
  maxItems: number
  showFollowups: boolean
}

export interface FollowUpRow {
  ownerName: string
  ask: string
  status: string
}

export interface ProgressDeps {
  loadFilter: () => Promise<PostFilter>
  crews: () => Promise<CrewOption[]>
  /** The scheduled event in progress in the call channel (or starting any minute), if any. */
  currentEvent: () => Promise<{ id: string; name: string } | null>
  lastCall: (crewId: string) => Promise<{ items: ActionItem[]; recordingId: string; startedAt: Date } | null>
  followUps: (recordingId: string) => Promise<FollowUpRow[]>
  openTasks: (crew: CrewOption) => Promise<{ tasks: CrewTaskDetail[]; error: boolean }>
  now: () => Date
}

export type ProgressResult =
  | { kind: 'report'; crewId: string; crewLabel: string; text: string }
  /** Nothing to show; `text` is safe to post (generic, never says why a crew is excluded). */
  | { kind: 'message'; text: string }

export const NO_REPORT = 'No progress report is available for this one right now.'
export const PICK_CREW = 'I could not tell which crew you mean. Run /progress and pick a crew.'

/** Follow-up statuses worth an icon; anything else (drafts, failures, dismissed) shows nothing. */
export function followUpIcon(status: string): string | null {
  switch (status) {
    case 'DONE':
      return '✅'
    case 'IN_PROGRESS':
      return '🔄'
    case 'NEEDS_HELP':
      return '🆘'
    case 'SENT':
    case 'REPLIED':
    case 'APPROVED':
    case 'ESCALATED':
      return '⏳'
    default:
      return null
  }
}

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const words = (s: string) => new Set(norm(s).split(' ').filter((w) => w.length > 3))

/**
 * The follow-up row that belongs to an action item: same owner, and the closest wording
 * (at least two shared longer words), or the only row of that owner when the owner has only one item.
 */
export function matchFollowUp(item: ActionItem, items: readonly ActionItem[], rows: readonly FollowUpRow[]): FollowUpRow | null {
  const owner = norm(item.owner)
  if (!owner) return null
  const mine = rows.filter((r) => norm(r.ownerName) === owner)
  if (!mine.length) return null
  const a = words(item.text)
  let best: FollowUpRow | null = null
  let bestScore = 0
  for (const r of mine) {
    const b = words(r.ask)
    let score = 0
    for (const w of a) if (b.has(w)) score++
    if (score > bestScore) {
      best = r
      bestScore = score
    }
  }
  if (best && bestScore >= 2) return best
  const ownerItems = items.filter((i) => norm(i.owner) === owner)
  return ownerItems.length === 1 && mine.length === 1 ? mine[0] : null
}

const ymd = (d: Date) => d.toISOString().slice(0, 10)

/** The Discord text. Pure. Item text is clipped and markdown-escaped. */
export function formatProgress(o: {
  crewLabel: string
  callDate: Date | null
  items: readonly { text: string; owner?: string | null; icon?: string | null }[]
  tasks: readonly AgendaBullet[]
  tasksUnavailable: boolean
  crewUrl?: string
}): string {
  const lines = [`**${clipTo(o.crewLabel, 80)} progress**`]
  if (o.items.length) {
    lines.push('', `Action items from the last call${o.callDate ? ` (${ymd(o.callDate)})` : ''}:`)
    for (const it of o.items) lines.push(`- ${it.icon ? `${it.icon} ` : ''}${clipTo(it.text, 140)}${it.owner ? ` (${clipTo(it.owner, 40)})` : ''}`)
  } else {
    lines.push('', 'No action items from the last call.')
  }
  if (o.tasks.length) {
    lines.push('', 'Open tasks:')
    for (const t of o.tasks) lines.push(`- ${t.text}`)
  } else if (o.tasksUnavailable) {
    lines.push('', 'Open tasks could not be loaded right now.')
  }
  if (o.crewUrl) lines.push('', `Crew page: ${o.crewUrl}`)
  return lines.join('\n')
}

/** The crew the member means: the option (id or label), else the call in progress. */
export async function resolveProgressCrew(optionValue: string | undefined, deps: Pick<ProgressDeps, 'crews' | 'currentEvent'>): Promise<CrewOption | null> {
  const crews = await deps.crews()
  const want = normalizeCrewId(optionValue)
  if (want) return crews.find((c) => c.id === want) ?? crews.find((c) => normalizeCrewId(c.label) === want) ?? null
  const ev = await deps.currentEvent()
  if (!ev) return null
  const hit = resolveCrewForEvent(crews.map((c) => ({ id: c.id, label: c.label, event: c.event })), { eventId: ev.id, eventName: ev.name })
  return hit ? (crews.find((c) => c.id === hit.crewId) ?? null) : null
}

/** Build the report. Never throws: a failure becomes a generic message. */
export async function buildProgressReport(
  optionValue: string | undefined,
  settings: ProgressSettings,
  deps: ProgressDeps,
  opts: { crewUrl?: (crewId: string) => string } = {},
): Promise<ProgressResult> {
  try {
    // Fail closed: an unreadable filter means no report, like the agenda and recap posts.
    const filter = await deps.loadFilter()
    const crew = await resolveProgressCrew(optionValue, deps)
    if (!crew) return { kind: 'message', text: PICK_CREW }
    if (isCrewExcluded(crew, filter)) return { kind: 'message', text: NO_REPORT }

    const now = deps.now()
    const max = settings.maxItems
    const [last, sheet] = await Promise.all([deps.lastCall(crew.id), deps.openTasks(crew)])

    const kept = (last?.items ?? []).filter((a) => !mentionsBlockedTerm(a.text, filter) && !mentionsBlockedTerm(a.owner, filter))
    const items = kept.slice(0, max)
    let rows: FollowUpRow[] = []
    if (settings.showFollowups && last && items.length) rows = await deps.followUps(last.recordingId).catch(() => [])
    const shown = items.map((a) => {
      const row = rows.length ? matchFollowUp(a, kept, rows) : null
      return { text: a.text, owner: a.owner, icon: row ? followUpIcon(row.status) : null }
    })

    const tasks = sheet.tasks.filter((t) => !mentionsBlockedTerm(t.label, filter))
    // Ranking reuse: overdue first, then Top/High priority, then in progress. No last-call items here (listed above).
    const bullets = buildAgendaBullets({ tasks, actionItems: [], now, limits: { bullets: max, tasks: max, followups: 0, chars: 110 } }).slice(0, max)

    return {
      kind: 'report',
      crewId: crew.id,
      crewLabel: crew.label,
      text: formatProgress({
        crewLabel: crew.label,
        callDate: last?.startedAt ?? null,
        items: shown,
        tasks: bullets,
        tasksUnavailable: sheet.error,
        crewUrl: opts.crewUrl?.(crew.id),
      }),
    }
  } catch (err) {
    console.error('[progress] report failed:', err instanceof Error ? err.message : String(err))
    return { kind: 'message', text: NO_REPORT }
  }
}
