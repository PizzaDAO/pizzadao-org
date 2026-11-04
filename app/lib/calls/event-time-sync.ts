/**
 * DST sync of crew call times (plans/dst-crew-call-times.md).
 *
 * Discord repeats a recurring scheduled event at a fixed UTC time, so after a clock change every call
 * is an hour off in local time. Each event listed in the setting `calls.eventLocalTimes` has an intended
 * wall-clock time and zone; this job compares the event's NEXT start with it and moves the event
 * (scheduled_start_time, and the recurrence_rule start so the series follows).
 *
 * Safety: ACTIVE events are never touched (retried next run); a shift larger than the cap is reported,
 * never applied; an occurrence about to start keeps its time; dry run and the feature switch are off
 * by default; preview and local deploys never patch; every outcome is logged to DiscordEventTimeChange.
 */
import { randomUUID } from 'node:crypto'
import { prisma } from '@/app/lib/db'
import { loadSettings } from '@/app/lib/settings'
import { resolveToggle } from '@/app/lib/settings/toggles'
import { savedChannelId } from '@/app/lib/settings/channels'
import { DEFAULT_CALL_VOICE_CHANNEL_ID } from '@/app/lib/call-agenda/run'
import { DiscordPostError, discordScheduledEventRequest, postDiscordMessage, type DiscordScheduledEventRaw } from '@/app/lib/discord-rest'
import { parseHHMM, wallTimeIn, zonedWallTimeToUtc } from './zoned-time'
import type { EventLocalTime } from '@/app/lib/settings/call-time-settings'

const MIN = 60_000
/** An occurrence this close to now keeps its time (the next run moves the following one). */
export const NEAR_START_MS = 20 * MIN
/** Most events patched in one run (more than there are crews). */
export const MAX_PATCHES_PER_RUN = 20
const PAUSE_BETWEEN_PATCHES_MS = 400

export type PlanAction = 'patch' | 'skipped_active' | 'skipped_guard'

export interface Plan {
  eventId: string
  eventName: string
  timeZone: string
  intendedLocal: string
  action: PlanAction
  oldStartMs: number
  newStartMs: number
  /** Why it is skipped (guard / active / too close). */
  reason?: string
  /** The PATCH body (action 'patch'). */
  body?: Record<string, unknown>
}

/** Discord weekdays: 0 = Monday ... 6 = Sunday. */
function discordWeekday(ms: number): number {
  return (new Date(ms).getUTCDay() + 6) % 7
}

function shiftDays(days: unknown, by: number): unknown {
  return Array.isArray(days) ? days.map((d) => (typeof d === 'number' ? (((d + by) % 7) + 7) % 7 : d)) : days
}

/** recurrence_rule for the PATCH: start moved to the new start, weekdays follow a UTC day change; read-only fields dropped. */
export function shiftedRecurrenceRule(rule: Record<string, unknown>, oldStartMs: number, newStartMs: number): Record<string, unknown> {
  const dayBy = discordWeekday(newStartMs) - discordWeekday(oldStartMs)
  const out: Record<string, unknown> = {
    start: new Date(newStartMs).toISOString(),
    frequency: rule.frequency,
    interval: rule.interval ?? 1,
  }
  if (Array.isArray(rule.by_weekday)) out.by_weekday = shiftDays(rule.by_weekday, dayBy)
  if (Array.isArray(rule.by_n_weekday)) {
    out.by_n_weekday = rule.by_n_weekday.map((x) =>
      x && typeof x === 'object' && typeof (x as { day?: unknown }).day === 'number'
        ? { ...(x as object), day: (((((x as { day: number }).day + dayBy) % 7) + 7) % 7) }
        : x,
    )
  }
  if (Array.isArray(rule.by_month)) out.by_month = rule.by_month
  if (Array.isArray(rule.by_month_day)) out.by_month_day = rule.by_month_day
  return out
}

export interface SyncEvent {
  id: string
  name: string
  channelId: string | null
  status: number
  startMs: number
  endMs: number | null
  recurrenceRule: Record<string, unknown> | null
}

export function toSyncEvent(raw: DiscordScheduledEventRaw): SyncEvent | null {
  const startMs = raw.scheduled_start_time ? Date.parse(raw.scheduled_start_time) : NaN
  if (!Number.isFinite(startMs)) return null
  const endMs = raw.scheduled_end_time ? Date.parse(raw.scheduled_end_time) : NaN
  return {
    id: String(raw.id),
    name: raw.name ?? '',
    channelId: raw.channel_id ?? null,
    status: raw.status ?? 0,
    startMs,
    endMs: Number.isFinite(endMs) ? endMs : null,
    recurrenceRule: raw.recurrence_rule && typeof raw.recurrence_rule === 'object' ? raw.recurrence_rule : null,
  }
}

/** The start the row intends for the occurrence at `startMs`: same local date (or the neighbour closest to it). */
export function intendedStart(startMs: number, row: Pick<EventLocalTime, 'localTime' | 'timeZone'>): number | null {
  const t = parseHHMM(row.localTime)
  if (!t) return null
  const w = wallTimeIn(startMs, row.timeZone)
  let best: number | null = null
  for (const d of [-1, 0, 1]) {
    const day = new Date(Date.UTC(w.year, w.month - 1, w.day + d))
    const c = zonedWallTimeToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), t.hour, t.minute, row.timeZone)
    if (best === null || Math.abs(c - startMs) < Math.abs(best - startMs)) best = c
  }
  return best
}

/** Decide what to do about one event; null when nothing needs doing (or it is not in play). */
export function planEvent(event: SyncEvent, row: EventLocalTime, nowMs: number, maxShiftMinutes: number): Plan | null {
  if (event.status !== 1 && event.status !== 2) return null // COMPLETED / CANCELED: ignored
  const target = intendedStart(event.startMs, row)
  if (target === null || Math.abs(target - event.startMs) < MIN) return null
  const base = {
    eventId: event.id,
    eventName: event.name,
    timeZone: row.timeZone,
    intendedLocal: row.localTime,
    oldStartMs: event.startMs,
    newStartMs: target,
  }
  const shiftMin = Math.round(Math.abs(target - event.startMs) / MIN)
  if (shiftMin > maxShiftMinutes) {
    return { ...base, action: 'skipped_guard', reason: `shift of ${shiftMin} min is over the ${maxShiftMinutes} min limit (moved on purpose, or the row is wrong)` }
  }
  if (event.status === 2) return { ...base, action: 'skipped_active', reason: 'event is running; retried later' }
  if (target <= nowMs || Math.abs(event.startMs - nowMs) < NEAR_START_MS || Math.abs(target - nowMs) < NEAR_START_MS) {
    return { ...base, action: 'skipped_guard', reason: 'occurrence is about to start; the next one is moved after it' }
  }
  const body: Record<string, unknown> = { scheduled_start_time: new Date(target).toISOString() }
  if (event.endMs !== null) body.scheduled_end_time = new Date(event.endMs + (target - event.startMs)).toISOString()
  if (event.recurrenceRule) body.recurrence_rule = shiftedRecurrenceRule(event.recurrenceRule, event.startMs, target)
  return { ...base, action: 'patch', body }
}

/** Plans for every call-channel event that has a row and needs attention. */
export function planEventTimeChanges(
  events: SyncEvent[],
  rows: readonly EventLocalTime[],
  o: { callChannelId: string; nowMs: number; maxShiftMinutes: number },
): Plan[] {
  const byId = new Map(rows.map((r) => [r.eventId, r]))
  const out: Plan[] = []
  for (const e of events) {
    const row = byId.get(e.id)
    if (!row || e.channelId !== o.callChannelId) continue
    const p = planEvent(e, row, o.nowMs, o.maxShiftMinutes)
    if (p) out.push(p)
  }
  return out.sort((a, b) => a.oldStartMs - b.oldStartMs || a.eventId.localeCompare(b.eventId))
}

export type LogAction = 'dry_run' | 'patched' | 'skipped_active' | 'skipped_guard' | 'failed'

export interface LogRow {
  runId: string
  eventId: string
  eventName: string
  timeZone: string
  intendedLocal: string
  oldStart: Date
  newStart: Date | null
  action: LogAction
  error: string | null
}

export interface SyncDeps {
  listEvents(): Promise<DiscordScheduledEventRaw[]>
  getEvent(id: string): Promise<DiscordScheduledEventRaw>
  patchEvent(id: string, body: Record<string, unknown>, reason: string): Promise<DiscordScheduledEventRaw>
  /** True when an identical row was already logged (same event, action and old start): keeps repeat runs quiet. */
  alreadyLogged(row: LogRow): Promise<boolean>
  logRow(row: LogRow): Promise<void>
  sleep(ms: number): Promise<void>
}

export interface SyncResult {
  runId: string
  dryRun: boolean
  checked: number
  patched: number
  wouldPatch: number
  skipped: number
  failed: number
  /** New rows written this run (repeats of an already-logged outcome are not counted). */
  logged: LogRow[]
  stoppedEarly: boolean
}

const fmtLocal = (ms: number, zone: string) => {
  const w = wallTimeIn(ms, zone)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${w.year}-${p(w.month)}-${p(w.day)} ${p(w.hour)}:${p(w.minute)}`
}

/**
 * Plan and (unless dryRun) apply. The core, with every outside call injected.
 * A 429 or Cloudflare block stops the run: the remaining events are logged as failed and tried next run.
 */
export async function executeEventTimeSync(
  o: { rows: readonly EventLocalTime[]; callChannelId: string; nowMs: number; maxShiftMinutes: number; dryRun: boolean; maxPatches?: number },
  deps: SyncDeps,
): Promise<SyncResult> {
  const runId = randomUUID()
  const result: SyncResult = { runId, dryRun: o.dryRun, checked: 0, patched: 0, wouldPatch: 0, skipped: 0, failed: 0, logged: [], stoppedEarly: false }
  const raw = await deps.listEvents()
  const events = raw.map(toSyncEvent).filter((e): e is SyncEvent => e !== null)
  const rowsById = new Map(o.rows.map((r) => [r.eventId, r]))
  result.checked = events.filter((e) => rowsById.has(e.id) && e.channelId === o.callChannelId).length
  const plans = planEventTimeChanges(events, o.rows, o)

  const log = async (p: Plan, action: LogAction, extra: { newStartMs?: number | null; error?: string | null; always?: boolean } = {}) => {
    const row: LogRow = {
      runId,
      eventId: p.eventId,
      eventName: p.eventName,
      timeZone: p.timeZone,
      intendedLocal: p.intendedLocal,
      oldStart: new Date(p.oldStartMs),
      newStart: extra.newStartMs === null ? null : new Date(extra.newStartMs ?? p.newStartMs),
      action,
      error: extra.error ?? p.reason ?? null,
    }
    if (!extra.always && (await deps.alreadyLogged(row))) return
    await deps.logRow(row)
    result.logged.push(row)
  }

  let patches = 0
  const maxPatches = o.maxPatches ?? MAX_PATCHES_PER_RUN
  for (const p of plans) {
    if (p.action !== 'patch') {
      result.skipped++
      await log(p, p.action)
      continue
    }
    if (o.dryRun) {
      result.wouldPatch++
      await log(p, 'dry_run')
      continue
    }
    if (result.stoppedEarly) {
      result.failed++
      await log(p, 'failed', { error: 'stopped earlier in this run (Discord rate limit); tried again next run', always: true })
      continue
    }
    if (patches >= maxPatches) {
      result.skipped++
      await log(p, 'skipped_guard', { error: `per-run limit of ${maxPatches} patches reached; tried again next run` })
      continue
    }
    patches++
    try {
      // Re-read just before writing: a host may have pressed Start or moved the event meanwhile.
      const fresh = toSyncEvent((await deps.getEvent(p.eventId)) as DiscordScheduledEventRaw)
      const row = rowsById.get(p.eventId)
      const again = fresh && row ? planEvent(fresh, row, o.nowMs, o.maxShiftMinutes) : null
      if (!fresh || !row) throw new Error('event could not be re-read')
      if (!again) continue // already right now
      if (again.action !== 'patch') {
        result.skipped++
        await log(again, again.action)
        continue
      }
      const res = (await deps.patchEvent(p.eventId, again.body as Record<string, unknown>, `DST sync: ${again.intendedLocal} ${again.timeZone}`)) as DiscordScheduledEventRaw
      const got = res.scheduled_start_time ? Date.parse(res.scheduled_start_time) : NaN
      const ok = Number.isFinite(got) && Math.abs(got - again.newStartMs) < MIN
      if (ok) {
        result.patched++
        await log(again, 'patched', { newStartMs: got, always: true })
      } else {
        result.failed++
        await log(again, 'failed', { newStartMs: Number.isFinite(got) ? got : null, error: 'Discord answered with a different start than requested', always: true })
      }
      await deps.sleep(PAUSE_BETWEEN_PATCHES_MS)
    } catch (err) {
      result.failed++
      const limited = err instanceof DiscordPostError && err.status === 429
      if (limited) result.stoppedEarly = true
      await log(p, 'failed', { error: (err instanceof Error ? err.message : String(err)).slice(0, 300), always: true })
    }
  }
  return result
}

/** A short Discord summary of a run's new log rows; null when there is nothing to say. */
export function formatSyncSummary(r: SyncResult): string | null {
  if (r.logged.length === 0) return null
  const lines = r.logged.slice(0, 15).map((l) => {
    const name = l.eventName || l.eventId
    const when = `${fmtLocal(l.oldStart.getTime(), l.timeZone)} -> ${l.newStart ? fmtLocal(l.newStart.getTime(), l.timeZone) : '?'} (${l.timeZone})`
    const what =
      l.action === 'patched' ? 'moved'
      : l.action === 'dry_run' ? 'would move'
      : l.action === 'skipped_active' ? 'running now, will retry'
      : l.action === 'skipped_guard' ? 'left alone'
      : 'FAILED'
    return `- ${name}: ${what}, ${when}${l.error && l.action !== 'patched' && l.action !== 'dry_run' ? ` [${l.error}]` : ''}`
  })
  const more = r.logged.length > 15 ? `\n(+${r.logged.length - 15} more in the log on /admin/calls)` : ''
  const head = r.dryRun ? 'Crew call times (dry run, nothing changed)' : 'Crew call times'
  return `${head}\n${lines.join('\n')}${more}`.slice(0, 1900)
}

export interface RunOptions {
  /** Plan and log only. Forced on for non-production deploys. */
  dryRun: boolean
  /** Pretend it is this moment (admin dry run only). */
  now?: Date
  /** Post the summary to the configured channel (cron: yes, admin preview: no). */
  post?: boolean
  env?: NodeJS.ProcessEnv
  deps?: SyncDeps
  fetchImpl?: typeof fetch
}

/** Whether the scheduled job should run at all: the switch is on (previews: env only) and settings are readable. */
export async function dstFixConfig(env: NodeJS.ProcessEnv = process.env) {
  const settings = await loadSettings()
  return {
    enabled: resolveToggle('calls.dstFixEnabled', settings, env),
    dryRun: settings.readFailed ? true : settings.get('calls.dstFixDryRun'),
    maxShiftMinutes: settings.get('calls.dstFixMaxShiftMinutes'),
    rows: settings.get('calls.eventLocalTimes'),
  }
}

function realDeps(guildId: string, botToken: string, fetchImpl?: typeof fetch): SyncDeps {
  const base = { guildId, botToken }
  const opts = { fetchImpl }
  return {
    listEvents: async () => (await discordScheduledEventRequest({ method: 'GET', ...base }, opts)) as DiscordScheduledEventRaw[],
    getEvent: async (id) => (await discordScheduledEventRequest({ method: 'GET', ...base, eventId: id }, opts)) as DiscordScheduledEventRaw,
    patchEvent: async (id, body, reason) =>
      (await discordScheduledEventRequest({ method: 'PATCH', ...base, eventId: id, body, reason }, opts)) as DiscordScheduledEventRaw,
    alreadyLogged: async (row) =>
      (await prisma.discordEventTimeChange.findFirst({
        where: { eventId: row.eventId, action: row.action, oldStart: row.oldStart, newStart: row.newStart },
        select: { id: true },
      })) !== null,
    logRow: async (row) => {
      await prisma.discordEventTimeChange.create({ data: row })
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  }
}

/** The whole job: read settings and Discord, plan, apply (or dry-run), log, and post a summary. */
export async function runEventTimeSync(o: RunOptions): Promise<SyncResult | { notRun: string }> {
  const env = o.env ?? process.env
  const token = env.DISCORD_BOT_TOKEN?.trim()
  const guild = env.DISCORD_GUILD_ID?.trim()
  if (!token || !guild) throw new Error('DISCORD_BOT_TOKEN / DISCORD_GUILD_ID not configured')
  const cfg = await dstFixConfig(env)
  if (cfg.rows.length === 0) return { notRun: 'no rows in "Crew call local times"' }
  const callChannelId = (await savedChannelId('discord.callVoiceChannelId')) || env.CALL_VOICE_CHANNEL_ID?.trim() || DEFAULT_CALL_VOICE_CHANNEL_ID
  // Only production changes Discord; previews and local runs share the database but must never patch.
  const dryRun = o.dryRun || env.VERCEL_ENV !== 'production'
  const result = await executeEventTimeSync(
    { rows: cfg.rows, callChannelId, nowMs: (o.now ?? new Date()).getTime(), maxShiftMinutes: cfg.maxShiftMinutes, dryRun },
    o.deps ?? realDeps(guild, token, o.fetchImpl),
  )
  const summary = formatSyncSummary(result)
  if (o.post && summary) {
    try {
      const channelId = await savedChannelId('discord.dstFixChannelId')
      if (channelId) await postDiscordMessage({ kind: 'bot', channelId, botToken: token }, { content: summary, allowed_mentions: { parse: [] } })
    } catch (err) {
      console.error('[event-time-sync] summary post failed:', err instanceof Error ? err.message : err)
    }
  }
  return result
}

/**
 * Rows for call-channel recurring events (SCHEDULED/ACTIVE with a recurrence rule) that have no row yet,
 * using each event's CURRENT next start rendered in `timeZone`. Existing rows are kept untouched.
 */
export function proposeRows(
  events: readonly SyncEvent[],
  existing: readonly EventLocalTime[],
  o: { callChannelId: string; timeZone: string },
): EventLocalTime[] {
  const have = new Set(existing.map((r) => r.eventId))
  const added: EventLocalTime[] = []
  for (const e of events) {
    if (have.has(e.id) || e.channelId !== o.callChannelId || !e.recurrenceRule) continue
    if (e.status !== 1 && e.status !== 2) continue
    const w = wallTimeIn(e.startMs, o.timeZone)
    added.push({ eventId: e.id, label: e.name.slice(0, 64), localTime: `${String(w.hour).padStart(2, '0')}:${String(w.minute).padStart(2, '0')}`, timeZone: o.timeZone })
  }
  added.sort((a, b) => a.label.localeCompare(b.label))
  return [...existing, ...added]
}

/** Call-channel events read from Discord with the call channel id used (for the admin page and fill). */
export async function fetchCallEvents(env: NodeJS.ProcessEnv = process.env): Promise<{ events: SyncEvent[]; callChannelId: string }> {
  const token = env.DISCORD_BOT_TOKEN?.trim()
  const guild = env.DISCORD_GUILD_ID?.trim()
  if (!token || !guild) throw new Error('DISCORD_BOT_TOKEN / DISCORD_GUILD_ID not configured')
  const callChannelId = (await savedChannelId('discord.callVoiceChannelId')) || env.CALL_VOICE_CHANNEL_ID?.trim() || DEFAULT_CALL_VOICE_CHANNEL_ID
  const raw = (await discordScheduledEventRequest({ method: 'GET', guildId: guild, botToken: token })) as DiscordScheduledEventRaw[]
  return { events: raw.map(toSyncEvent).filter((e): e is SyncEvent => e !== null), callChannelId }
}
