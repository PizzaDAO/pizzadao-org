/**
 * The spoken call-updates script (plans/metalhead-reads-updates.md, section 1): a deterministic,
 * template-built text, no AI rewrite. Sections, in the order the admin setting gives:
 *
 *   intro (always) / last-call / task-changes / priorities / events / announcements / outro (always)
 *
 * Privacy parity with the pre-call agenda and /progress: an excluded crew gets nothing, blocked terms
 * drop items, a filter that cannot be read means no script, an action-item owner whose speaker was
 * redacted is not named, and a last call with redactions newer than its summary is skipped entirely.
 * The script text itself is never logged (only its hash and section counts).
 *
 * Everything external is injected (UpdatesDeps), so the builder is testable without Discord or a DB.
 */
import { createHash } from 'node:crypto'
import type { CrewOption, CrewTaskDetail } from '@/app/lib/crew-mappings'
import { normalizeCrewId } from '@/app/lib/crew-id'
import { isCrewExcluded, mentionsBlockedTerm, type PostFilter } from '@/app/lib/calls/post-filters'
import { buildAgendaBullets, type ActionItem } from '@/app/lib/call-agenda/rank'
import type { Settings } from '@/app/lib/settings'
import {
  COMMAND_PHRASE,
  UPDATES_INTRO_DEFAULT,
  UPDATES_OUTRO_DEFAULT,
  UPDATE_SECTION_KEYS,
  type UpdateSectionKey,
} from '@/app/lib/settings/call-updates-settings'

export const WORDS_PER_MINUTE = 150
export const MAX_LAST_CALL_ITEMS = 3
export const MAX_TASK_NAMES = 2
export const MAX_PRIORITIES = 2
export const MAX_EVENTS = 2
export const MAX_ANNOUNCEMENTS = 3

/** Sections are dropped in this order (lowest ranked first) until the script fits the time budget. */
export const DROP_ORDER: readonly UpdateSectionKey[] = ['announcements', 'events', 'priorities', 'task-changes', 'last-call']

export interface UpdatesSettings {
  maxSeconds: number
  sections: UpdateSectionKey[]
  intro: string
  outro: string
  announcements: string
  /** Characters per spoken item (the agenda's item length). */
  itemChars: number
}

export interface LastCallData {
  items: ActionItem[]
  startedAt: Date
  /** Redactions are newer than the summary: the action items may still hold hidden content. */
  redactionsStale: boolean
  /** Display names of redacted speakers (their action items are read without an owner). */
  redactedNames: string[]
}

export interface UpdatesDeps {
  loadFilter: () => Promise<PostFilter>
  crews: () => Promise<CrewOption[]>
  lastCall: (crewId: string) => Promise<LastCallData | null>
  /** Task labels done / created since `since`. */
  taskChanges: (crewId: string, since: Date) => Promise<{ done: string[]; created: string[] }>
  openTasks: (crew: CrewOption) => Promise<{ tasks: CrewTaskDetail[]; error: boolean }>
  /** Upcoming scheduled events in the next days, soonest first (the current call is excluded by the caller). */
  upcomingEvents: (now: Date) => Promise<Array<{ name: string; startsAt: Date }>>
  now: () => Date
  /** The weekday label for an event ("Thursday", "today"); injectable for tests. */
  dayLabel?: (startsAt: Date, now: Date) => string
}

export interface ScriptSection {
  key: UpdateSectionKey | 'intro' | 'outro'
  lines: string[]
}

export type ScriptResult =
  | {
      kind: 'script'
      crewId: string
      crewLabel: string
      sections: ScriptSection[]
      /** The spoken text, one section per paragraph. */
      text: string
      estSeconds: number
      hash: string
      /** Sections cut by the time budget (in the order they were dropped). */
      dropped: UpdateSectionKey[]
    }
  | { kind: 'none'; reason: 'crew-unknown' | 'excluded' | 'filter-unreadable' | 'empty' | 'error' }

export function parseSections(raw: string): UpdateSectionKey[] {
  const out: UpdateSectionKey[] = []
  for (const l of raw.split('\n')) {
    const k = l.trim() as UpdateSectionKey
    if ((UPDATE_SECTION_KEYS as readonly string[]).includes(k) && !out.includes(k)) out.push(k)
  }
  return out
}

/** Text safe to hand to the voice: no markdown, URLs, mentions, emoji or Discord markup. */
export function speakable(input: string | null | undefined, max = 160): string {
  let s = String(input ?? '')
  // Undo the markdown escaping the agenda ranking adds.
  s = s.replace(/\\([\\*_~`|>[\]<])/g, '$1')
  s = s.replace(/<a?:\w+:\d+>/g, ' ') // custom emoji
  s = s.replace(/<(?:@[!&]?|#)\d+>/g, ' ') // user / role / channel mentions
  s = s.replace(/<t:\d+(?::[a-zA-Z])?>/g, ' ') // timestamps
  s = s.replace(/@(?:everyone|here)\b/gi, ' ')
  s = s.replace(/\b(?:https?:\/\/|www\.)\S+/gi, ' ')
  s = s.replace(/\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u200d\ufe0f\u20e3]/gu, ' ')
  s = s.replace(/[*_~`|>#[\]<]/g, ' ')
  s = s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  if (s.length > max) s = `${s.slice(0, max - 1).trimEnd()}…`
  return s
}

const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length
export const estimateSeconds = (text: string) => Math.ceil((wordCount(text) / WORDS_PER_MINUTE) * 60)

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** "Crew label: text" lines are read only on that crew's call; any other line is read everywhere. */
export function announcementLines(raw: string, crew: { id: string; label: string }, knownCrews: readonly { id: string; label: string }[]): string[] {
  const out: string[] = []
  for (const line of raw.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const m = /^([^:]{1,60}):\s*(.+)$/.exec(line)
    const prefix = m ? norm(m[1]) : ''
    const owner = prefix ? knownCrews.find((c) => norm(c.label) === prefix || normalizeCrewId(c.id) === normalizeCrewId(m![1])) : undefined
    if (m && owner) {
      if (owner.id === crew.id) out.push(m[2])
      continue
    }
    out.push(line)
  }
  return out
}

const defaultDayLabel = (startsAt: Date, now: Date): string => {
  const days = Math.floor((startsAt.getTime() - now.getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'tomorrow'
  return `on ${new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'America/New_York' }).format(startsAt)}`
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const andJoin = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

/** Build the script for one crew. Never throws: a failure becomes { kind: 'none' }. */
export async function buildUpdatesScript(crewId: string, settings: UpdatesSettings, deps: UpdatesDeps): Promise<ScriptResult> {
  try {
    // Fail closed: an unreadable filter means no script, like the agenda and recap posts.
    let filter: PostFilter
    try {
      filter = await deps.loadFilter()
    } catch {
      return { kind: 'none', reason: 'filter-unreadable' }
    }
    const crews = await deps.crews()
    const want = normalizeCrewId(crewId)
    const crew = crews.find((c) => c.id === want)
    if (!crew) return { kind: 'none', reason: 'crew-unknown' }
    if (isCrewExcluded(crew, filter)) return { kind: 'none', reason: 'excluded' }

    const now = deps.now()
    const chars = settings.itemChars
    const say = (s: string | null | undefined) => speakable(s, chars)
    const blocked = (s: string | null | undefined) => mentionsBlockedTerm(s ?? '', filter)
    const wants = (k: UpdateSectionKey) => settings.sections.includes(k)

    const last = wants('last-call') || wants('task-changes') ? await deps.lastCall(crew.id).catch(() => null) : null
    const sections = new Map<UpdateSectionKey, string[]>()

    // 1. From last call. Skipped when redactions are newer than the summary.
    if (wants('last-call') && last && !last.redactionsStale) {
      const redacted = new Set(last.redactedNames.map(norm).filter(Boolean))
      const kept = last.items.filter((a) => !blocked(a.text) && !blocked(a.owner))
      const done = kept.filter((a) => a.done === true).length
      const open = kept.filter((a) => a.done !== true)
      const lines: string[] = []
      if (kept.length) {
        lines.push(
          done > 0
            ? `From last call, ${done} of ${plural(kept.length, 'action item', 'action items')} ${done === 1 ? 'is' : 'are'} done.`
            : `From last call, ${plural(open.length, 'action item is', 'action items are')} still open.`,
        )
        for (const a of open.slice(0, MAX_LAST_CALL_ITEMS)) {
          const text = say(a.text)
          if (!text) continue
          const owner = a.owner && !redacted.has(norm(a.owner)) ? say(a.owner) : ''
          lines.push(`Still open: ${text}${owner ? `, with ${owner}` : ''}.`)
        }
      }
      if (lines.length) sections.set('last-call', lines)
    }

    // 2. Task changes since the last call.
    if (wants('task-changes') && last) {
      const ch = await deps.taskChanges(crew.id, last.startedAt).catch(() => null)
      if (ch) {
        const done = ch.done.filter((l) => !blocked(l))
        const created = ch.created.filter((l) => !blocked(l))
        const parts: string[] = []
        if (done.length) parts.push(`${plural(done.length, 'task was', 'tasks were')} completed`)
        if (created.length) parts.push(`${plural(created.length, 'new task was', 'new tasks were')} added`)
        if (parts.length) {
          const lines = [`Since the last call, ${parts.join(' and ')}.`]
          const names = done.slice(0, MAX_TASK_NAMES).map((l) => say(l)).filter(Boolean)
          if (names.length) lines.push(`Completed: ${andJoin(names)}.`)
          sections.set('task-changes', lines)
        }
      }
    }

    // 3. Top priorities and overdue tasks (the agenda ranking, urgent kinds only).
    if (wants('priorities')) {
      const sheet = await deps.openTasks(crew).catch(() => ({ tasks: [] as CrewTaskDetail[], error: true }))
      const tasks = sheet.tasks.filter((t) => !blocked(t.label))
      const bullets = buildAgendaBullets({ tasks, actionItems: [], now, limits: { bullets: MAX_PRIORITIES, tasks: MAX_PRIORITIES, followups: 0, chars } })
        .filter((b) => b.kind === 'overdue' || b.kind === 'priority')
        .slice(0, MAX_PRIORITIES)
      const lines = bullets.map((b) => say(b.text.replace(/^Overdue (\d+)d:/, 'Overdue $1 days:'))).filter(Boolean)
      if (lines.length) sections.set('priorities', lines.map((l) => `${l}.`.replace(/\.\.$/, '.')))
    }

    // 4. Upcoming events.
    if (wants('events')) {
      const events = await deps.upcomingEvents(now).catch(() => [])
      const seen = new Set<string>()
      const lines: string[] = []
      for (const e of events) {
        const name = say(e.name)
        if (!name || blocked(e.name) || seen.has(norm(name))) continue
        seen.add(norm(name))
        lines.push(`Coming up: ${name}, ${(deps.dayLabel ?? defaultDayLabel)(e.startsAt, now)}.`)
        if (lines.length >= MAX_EVENTS) break
      }
      if (lines.length) sections.set('events', lines)
    }

    // 5. Admin announcements.
    if (wants('announcements') && settings.announcements.trim()) {
      const lines = announcementLines(settings.announcements, crew, crews)
        .filter((l) => !blocked(l))
        .map((l) => say(l))
        .filter(Boolean)
        .slice(0, MAX_ANNOUNCEMENTS)
        .map((l) => (/[.!?…]$/.test(l) ? l : `${l}.`))
      if (lines.length) sections.set('announcements', lines)
    }

    // Intro and outro: a command phrase would let an echo trigger the voice commands, so fall back to the defaults.
    const safe = (t: string, fallback: string) => (COMMAND_PHRASE.test(t) || !speakable(t) ? fallback : t)
    const intro = speakable(safe(settings.intro, UPDATES_INTRO_DEFAULT).replace(/\{crew\}/g, crew.label), 200)
    const outro = speakable(safe(settings.outro, UPDATES_OUTRO_DEFAULT), 200)

    const order = settings.sections.filter((k) => sections.has(k))
    if (order.length === 0) return { kind: 'none', reason: 'empty' }

    const compose = (keys: UpdateSectionKey[]): ScriptSection[] => [
      { key: 'intro', lines: [intro] },
      ...keys.map((k) => ({ key: k, lines: sections.get(k)! })),
      { key: 'outro', lines: [outro] },
    ]
    const textOf = (s: ScriptSection[]) => s.map((x) => x.lines.join(' ')).join('\n\n')

    // Fit the time budget by dropping whole sections, lowest ranked first.
    let keys = [...order]
    const dropped: UpdateSectionKey[] = []
    while (keys.length && estimateSeconds(textOf(compose(keys))) > settings.maxSeconds) {
      const victim = DROP_ORDER.find((k) => keys.includes(k))!
      keys = keys.filter((k) => k !== victim)
      dropped.push(victim)
    }
    if (keys.length === 0) return { kind: 'none', reason: 'empty' }

    const out = compose(keys)
    const text = textOf(out)
    return {
      kind: 'script',
      crewId: crew.id,
      crewLabel: crew.label,
      sections: out,
      text,
      estSeconds: estimateSeconds(text),
      hash: createHash('sha256').update(text).digest('hex').slice(0, 16),
      dropped,
    }
  } catch (err) {
    console.error('[call-updates] script failed:', err instanceof Error ? err.message : String(err))
    return { kind: 'none', reason: 'error' }
  }
}

/** Read the settings the builder needs. */
export function updatesSettings(settings: Settings, itemChars: number): UpdatesSettings {
  return {
    maxSeconds: settings.get('calls.updatesMaxSeconds'),
    sections: parseSections(settings.get('calls.updatesSections')),
    intro: settings.get('calls.updatesIntro') || UPDATES_INTRO_DEFAULT,
    outro: settings.get('calls.updatesOutro') || UPDATES_OUTRO_DEFAULT,
    announcements: settings.get('calls.updatesAnnouncements'),
    itemChars,
  }
}
