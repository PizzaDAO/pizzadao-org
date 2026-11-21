/**
 * "Start crew call" (plans/neapolitan-96018.md). Pure decision plus a runner with injected dependencies,
 * so the permission-free logic (which occurrence, busy channel, cooldown, claim race, preview no-op) is
 * tested without Discord or a database. The route wires the real dependencies (crew-call-start-live.ts).
 *
 * Metalhead records on its own once someone is in the voice channel of an ACTIVE event, so nothing here
 * talks to the recorder. Starting means: set the crew's Discord event ACTIVE (or create a one-off event),
 * and post a short note in the crew channel.
 */
export const EVENT_STATUS_SCHEDULED = 1
export const EVENT_STATUS_ACTIVE = 2
export const EVENT_STATUS_CANCELED = 4

/** A live session counts as live while the recorder has reported it this recently. */
export const LIVE_FRESH_MS = 2 * 60_000
const ADHOC_LEAD_MS = 60_000

export interface CrewCallSettings {
  allowAdHoc: boolean
  startWindowMinutes: number
  cooldownMinutes: number
  pingRole: boolean
  postTemplate: string
}

export interface EventLite {
  id: string
  status: number
  scheduledStartMs: number
  channelId: string | null
}

export interface LiveSessionLite {
  crewId: string | null
  crewLabel: string | null
  channelId: string | null
  lastSeenAtMs: number
  endedAt: boolean
}

export interface DecideInput {
  nowMs: number
  crewId: string
  /** The crew's mapped Discord event, or null when it has none or it could not be read. */
  event: EventLite | null
  /** The crew's voice channel (event channel, setting, default), or null. */
  voiceChannelId: string | null
  /** Channels the recorder may join. */
  recordable: readonly string[]
  live: readonly LiveSessionLite[]
  /** Recent starts from the page (any crew), including ones whose channel post failed. */
  recentStarts?: readonly { crewId: string; crewLabel?: string | null; channelId: string | null; createdAtMs: number }[]
  /** An ad hoc event this crew started is still ACTIVE in Discord. */
  adHocActive?: boolean
  /** When this crew last started a call from the page (successfully), or null. */
  lastStartMs: number | null
  /** The crew's next scheduled call, for the not-scheduled answer. */
  nextCallMs: number | null
  settings: CrewCallSettings
}

export type Decision =
  | { kind: 'start_event'; occurrenceKey: string; eventId: string; channelId: string }
  | { kind: 'start_adhoc'; occurrenceKey: string; channelId: string; startMs: number }
  | { kind: 'already_live' }
  | { kind: 'not_scheduled'; nextCallMs: number | null }
  | { kind: 'not_recordable'; channelId: string | null }
  | { kind: 'channel_busy'; otherCrewLabel: string }
  | { kind: 'cooldown'; untilMs: number }

const isLive = (s: LiveSessionLite, nowMs: number) => !s.endedAt && nowMs - s.lastSeenAtMs <= LIVE_FRESH_MS

export function decideCrewCallStart(i: DecideInput): Decision {
  const { nowMs, settings } = i
  // Already running: the event is active, or the recorder reports a live session of this crew.
  if (i.event?.status === EVENT_STATUS_ACTIVE || i.adHocActive) return { kind: 'already_live' }
  if (i.live.some((s) => isLive(s, nowMs) && s.crewId === i.crewId)) return { kind: 'already_live' }

  if (i.lastStartMs !== null) {
    const until = i.lastStartMs + settings.cooldownMinutes * 60_000
    if (until > nowMs) return { kind: 'cooldown', untilMs: until }
  }

  const channelId = i.voiceChannelId
  if (!channelId || !i.recordable.includes(channelId)) return { kind: 'not_recordable', channelId }

  const other = i.live.find((s) => isLive(s, nowMs) && s.channelId === channelId && s.crewId !== i.crewId)
  if (other) return { kind: 'channel_busy', otherCrewLabel: other.crewLabel || other.crewId || 'Another call' }

  // A start from the page by another crew in this channel, within the cooldown, holds the channel too
  // (the recorder may not have reported it yet).
  const recent = i.recentStarts?.find((r) => r.crewId !== i.crewId && r.channelId === channelId && r.createdAtMs + settings.cooldownMinutes * 60_000 > nowMs)
  if (recent) return { kind: 'channel_busy', otherCrewLabel: recent.crewLabel || recent.crewId }

  const windowMs = settings.startWindowMinutes * 60_000
  if (i.event && i.event.status === EVENT_STATUS_SCHEDULED && Math.abs(i.event.scheduledStartMs - nowMs) <= windowMs) {
    return {
      kind: 'start_event',
      occurrenceKey: `${i.event.id}:${new Date(i.event.scheduledStartMs).toISOString()}`,
      eventId: i.event.id,
      channelId,
    }
  }
  if (settings.allowAdHoc) {
    return {
      kind: 'start_adhoc',
      // One row per crew while its cooldown lasts: a second ad hoc start cannot slip in at a bucket edge.
      occurrenceKey: `adhoc:${i.crewId}:active`,
      channelId,
      startMs: nowMs + ADHOC_LEAD_MS,
    }
  }
  return { kind: 'not_scheduled', nextCallMs: i.nextCallMs }
}

export interface ClaimRow {
  occurrenceKey: string
  crewId: string
  eventId: string | null
  adHoc: boolean
  channelId: string | null
  startedBy: string
  /** An existing claim older than this many ms is stale and is replaced (ad hoc rows). */
  reclaimOlderThanMs?: number
}

export interface StartDeps {
  /** True only on the production deploy; anything else never writes to Discord. */
  isProduction: boolean
  now: () => number
  /** Insert the claim. ok:false means the key exists (someone else started this occurrence). */
  claim: (row: ClaimRow) => Promise<{ ok: true } | { ok: false; by: string; atMs: number }>
  release: (occurrenceKey: string) => Promise<void>
  /** Record the post result on the claim row (best effort). */
  annotate: (occurrenceKey: string, patch: { postMessageId?: string | null; error?: string | null }) => Promise<void>
  discord: {
    setActive: (eventId: string, reason: string) => Promise<void>
    createAdHoc: (o: { name: string; channelId: string; startMs: number; endMs: number; reason: string }) => Promise<{ id: string }>
    cancel: (eventId: string, reason: string) => Promise<void>
    post: (o: { content: string; mentionRoleId: string | null }) => Promise<{ id: string | null }>
  }
}

export interface StartInput {
  decision: Decision
  crewId: string
  crewLabel: string
  startedBy: string
  /** Member number or name for the audit-log reason. */
  startedByLabel: string
  callLengthMinutes: number
  voiceUrl: string
  liveUrl: string
  roleId: string | null
  settings: CrewCallSettings
}

export type StartResult =
  | { status: 'started'; occurrenceKey: string; eventId: string; adHoc: boolean; posted: boolean }
  | { status: 'preview'; wouldDo: Decision['kind'] }
  | { status: 'already_started'; by: string; atMs: number }
  | { status: 'discord_failed'; code: 'bot_permissions' | 'discord_error' }
  | { status: Exclude<Decision['kind'], 'start_event' | 'start_adhoc'>; decision: Decision }

/** Fill {crew}, {voice} and {live}; no pings unless the caller adds one. */
export function renderPost(template: string, v: { crew: string; voice: string; live: string }): string {
  return template.replaceAll('{crew}', v.crew).replaceAll('{voice}', v.voice).replaceAll('{live}', v.live).trim().slice(0, 1800)
}

export async function runCrewCallStart(i: StartInput, d: StartDeps): Promise<StartResult> {
  const dec = i.decision
  if (dec.kind !== 'start_event' && dec.kind !== 'start_adhoc') return { status: dec.kind, decision: dec }
  // Previews share the production database and guild: answer what would happen, write nothing.
  if (!d.isProduction) return { status: 'preview', wouldDo: dec.kind }

  const claim = await d.claim({
    occurrenceKey: dec.occurrenceKey,
    crewId: i.crewId,
    eventId: dec.kind === 'start_event' ? dec.eventId : null,
    adHoc: dec.kind === 'start_adhoc',
    channelId: dec.channelId,
    startedBy: i.startedBy,
    ...(dec.kind === 'start_adhoc' ? { reclaimOlderThanMs: i.settings.cooldownMinutes * 60_000 } : {}),
  })
  if (!claim.ok) return { status: 'already_started', by: claim.by, atMs: claim.atMs }

  const reason = `Started from the crew page by ${i.startedByLabel}`
  let eventId: string
  try {
    if (dec.kind === 'start_event') {
      await d.discord.setActive(dec.eventId, reason)
      eventId = dec.eventId
    } else {
      const created = await d.discord.createAdHoc({
        name: `${i.crewLabel} call`,
        channelId: dec.channelId,
        startMs: dec.startMs,
        endMs: dec.startMs + i.callLengthMinutes * 60_000,
        reason,
      })
      eventId = created.id
      try {
        await d.discord.setActive(created.id, reason)
      } catch (e) {
        await d.discord.cancel(created.id, 'Could not start; canceled').catch(() => {})
        throw e
      }
    }
  } catch (e) {
    // Nothing started: let the next press try again.
    await d.release(dec.occurrenceKey).catch(() => {})
    // Raw Discord text stays in the server log; the client gets a code.
    console.error('[crew-call-start] Discord write failed:', e instanceof Error ? e.message : e)
    const code = (e as { status?: number })?.status === 403 ? 'bot_permissions' : 'discord_error'
    return { status: 'discord_failed', code }
  }

  let posted = false
  const content = renderPost(i.settings.postTemplate, { crew: i.crewLabel, voice: i.voiceUrl, live: i.liveUrl })
  if (content) {
    try {
      const mention = i.settings.pingRole ? i.roleId : null
      const msg = await d.discord.post({ content: mention ? `<@&${mention}> ${content}` : content, mentionRoleId: mention })
      posted = true
      await d.annotate(dec.occurrenceKey, { postMessageId: msg.id }).catch(() => {})
    } catch (e) {
      // The call is started; a failed note does not undo it.
      await d.annotate(dec.occurrenceKey, { error: `post failed: ${e instanceof Error ? e.message : 'error'}`.slice(0, 300) }).catch(() => {})
    }
  }
  return { status: 'started', occurrenceKey: dec.occurrenceKey, eventId, adHoc: dec.kind === 'start_adhoc', posted }
}
