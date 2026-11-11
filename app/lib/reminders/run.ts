/**
 * The 5-minute reminders run (phase B1: call reminders by Discord DM).
 *
 *  1. Find the call occurrences due now (Discord scheduled events, see schedule.ts).
 *  2. Pair each with the members who opted in and want that crew.
 *  3. Off (toggle off, or not production): count what WOULD be sent and log counts only. Nothing is claimed.
 *  4. On: per pair, check the member's DM reach and daily cap, claim the (member, occurrence) row BEFORE
 *     sending, send, record. A 403 marks the member CLOSED (backoff); a 429 stops the run; an uncertain
 *     failure releases the claim (at most 3 attempts).
 *
 * Logs and results carry counts only, never member ids or names.
 */
import { SITE_URL } from '@/app/lib/site-url'
import { capDecision, DAY_MS } from '@/app/lib/followups/quiet-hours'
import { loadPostFilter, type PostFilter } from '@/app/lib/calls/post-filters'
import { getCrewMappings } from '@/app/lib/crew-mappings'
import { fetchUpcomingEvents } from '@/app/lib/call-agenda/run'
import { fetchMemberById, fetchMemberIdByDiscordId } from '@/app/lib/sheets/member-repository'
import { loadSettings } from '@/app/lib/settings'
import { toggleEnabled } from '@/app/lib/settings/toggles'
import { sendDiscordDm } from '@/app/lib/followups/discord-dm'
import { deliverDm,reminderSendAllowed, type DmSender } from './deliver'
import { callReminderComponents, callReminderText } from './messages'
import { canTryDm, loadDmReach, recordDmClosed, recordDmOk, type DmReach } from './reach'
import {
  HORIZON_SLACK_MS,
  MINUTE_MS,
  SAME_EVENT_WINDOW_MS,
  crewIdsFromCell,
  dueOccurrences,
  wantsCrew,
  type CallOccurrence,
  type CrewLite,
  type PrefLite,
  type RawEvent,
} from './schedule'
import { MAX_ATTEMPTS, prismaStore, sweepOldCallSends, type ReminderStore } from './store'

export interface RunConfig {
  enabled: boolean
  leadMinutes: number
  maxSendsPerRun: number
  maxPerMemberPerDay: number
}

export interface RunResult {
  dryRun: boolean
  occurrences: number
  /** Opted-in (member, occurrence) pairs. */
  due: number
  sent: number
  skipped: Record<string, number>
  retried: number
  failed: number
  stoppedEarly: boolean
}

export interface RunDeps {
  now: Date
  env: Record<string, string | undefined>
  config: RunConfig
  store: ReminderStore
  loadOccurrences: (o: { now: Date; horizonMs: number; leadMs: number }) => Promise<CallOccurrence[]>
  /** The crew ids in the member's own row (for MY_CREWS), resolved at send time. */
  memberCrewIds: (discordId: string) => Promise<string[]>
  getReach: (discordId: string) => Promise<DmReach | null>
  setClosed: (discordId: string, prev: DmReach | null, now: Date) => Promise<void>
  setOk: (discordId: string, now: Date) => Promise<void>
  send: DmSender
  settingsUrl: (discordId: string) => Promise<string | null>
  guildId: string | null
  /** Pause between sends (about 4 per second). */
  sleep: (ms: number) => Promise<void>
}

const PACE_MS = 250

const bump = (m: Record<string, number>, k: string) => {
  m[k] = (m[k] ?? 0) + 1
}

export async function runCallReminders(d: RunDeps): Promise<RunResult> {
  const { now, config } = d
  const leadMs = config.leadMinutes * MINUTE_MS
  const dryRun = !config.enabled || !reminderSendAllowed(d.env)
  const res: RunResult = { dryRun, occurrences: 0, due: 0, sent: 0, skipped: {}, retried: 0, failed: 0, stoppedEarly: false }

  const occurrences = await d.loadOccurrences({ now, horizonMs: leadMs + HORIZON_SLACK_MS, leadMs })
  res.occurrences = occurrences.length
  if (!occurrences.length) return res
  const prefs = await d.store.listCallPrefs()
  if (!prefs.length) return res

  // (member, occurrence) pairs, soonest call first.
  const crewMemo = new Map<string, Promise<string[]>>()
  const crewsOf = (id: string) => {
    let p = crewMemo.get(id)
    if (!p) crewMemo.set(id, (p = d.memberCrewIds(id).catch(() => [])))
    return p
  }
  const pairs: Array<{ pref: PrefLite; occ: CallOccurrence }> = []
  for (const occ of occurrences) {
    for (const pref of prefs) {
      const mine = pref.calls === 'MY_CREWS' ? await crewsOf(pref.discordId) : []
      if (wantsCrew(pref, occ.crewId, mine)) pairs.push({ pref, occ })
    }
  }
  res.due = pairs.length
  if (dryRun || !pairs.length) return res

  const sentToday = await d.store.sentSince([...new Set(pairs.map((p) => p.pref.discordId))], new Date(now.getTime() - DAY_MS))
  let first = true

  for (const { pref, occ } of pairs) {
    if (res.sent >= config.maxSendsPerRun) {
      res.stoppedEarly = true
      break
    }
    const id = pref.discordId

    // Closed DMs: one attempt, then quiet until the backoff passes.
    const reach = await d.getReach(id)
    if (!canTryDm(reach, now)) {
      bump(res.skipped, 'dm_closed')
      continue
    }
    // Daily cap, all reminder kinds together.
    const cap = capDecision(sentToday.get(id) ?? [], now, config.maxPerMemberPerDay)
    if (!cap.ok) {
      bump(res.skipped, 'cap')
      continue
    }
    // A moved call already reminded for: one DM per event until the "time changed" correction exists.
    if (await d.store.sentForEventSince(id, occ.eventId, new Date(now.getTime() - SAME_EVENT_WINDOW_MS))) {
      bump(res.skipped, 'same_event')
      continue
    }
    const claim = await d.store.claimCall(id, occ.refKey)
    if (!claim.claimed) {
      bump(res.skipped, 'already')
      continue
    }

    if (!first) await d.sleep(PACE_MS)
    first = false

    const text = callReminderText({ crewLabel: occ.crewLabel, startsAt: occ.startsAt, guildId: d.guildId, eventId: occ.eventId })
    const components = callReminderComponents(await d.settingsUrl(id).catch(() => null))
    const outcome = await deliverDm({ discordId: id, text, components, send: d.send })

    switch (outcome.kind) {
      case 'sent':
        await d.store.markSent(id, occ.refKey)
        await d.setOk(id, now).catch(() => undefined)
        sentToday.set(id, [...(sentToday.get(id) ?? []), now])
        res.sent++
        break
      case 'closed':
        await d.store.markSkipped(id, occ.refKey, 'dm_closed')
        await d.setClosed(id, reach, now).catch(() => undefined)
        bump(res.skipped, 'dm_closed')
        break
      case 'rate_limited':
        // Nothing was posted: put it back for the next run and stop this one.
        await d.store.release(id, occ.refKey, 'rate_limited', claim.attempts, false)
        res.stoppedEarly = true
        return res
      case 'retry':
        if (claim.attempts + 1 >= MAX_ATTEMPTS) {
          await d.store.markFailed(id, occ.refKey, outcome.code)
          res.failed++
        } else {
          await d.store.release(id, occ.refKey, outcome.code, claim.attempts, true)
          res.retried++
        }
        break
      case 'failed':
        await d.store.markFailed(id, occ.refKey, outcome.code)
        res.failed++
        break
    }
  }
  return res
}

/** The real wiring, used by the cron route. */
export async function runCallRemindersNow(now = new Date(), env: NodeJS.ProcessEnv = process.env): Promise<RunResult> {
  const settings = await loadSettings()
  const config: RunConfig = {
    enabled: await toggleEnabled('reminders.callsEnabled', env),
    leadMinutes: settings.get('reminders.callLeadMinutes'),
    maxSendsPerRun: settings.get('reminders.maxSendsPerRun'),
    maxPerMemberPerDay: settings.get('reminders.maxPerMemberPerDay'),
  }
  let crews: CrewLite[] = []
  const result = await runCallReminders({
    now,
    env,
    config,
    store: prismaStore,
    loadOccurrences: async ({ now: n, horizonMs, leadMs }) => {
      // Throws when the editorial filter cannot be read: better no reminder than an unfiltered one.
      const filter: PostFilter = await loadPostFilter()
      const events = await fetchUpcomingEvents({ now: n, horizonMs })
      if (!events.length) return []
      crews = (await getCrewMappings()).crews.map((c) => ({ id: c.id, label: c.label, event: c.event }))
      const raw: RawEvent[] = events.map((e) => ({ id: e.id, name: e.name, status: e.status, startsAt: e.startsAt }))
      return dueOccurrences({ events: raw, crews, filter, now: n, leadMs })
    },
    memberCrewIds: async (discordId) => {
      const memberId = await fetchMemberIdByDiscordId(discordId)
      const row = memberId ? await fetchMemberById(memberId) : null
      return crewIdsFromCell(row?.['Crews'], crews)
    },
    getReach: loadDmReach,
    setClosed: recordDmClosed,
    setOk: recordDmOk,
    send: (id, text, opts) => sendDiscordDm(id, text, opts),
    settingsUrl: async (discordId) => {
      const memberId = await fetchMemberIdByDiscordId(discordId)
      return memberId ? `${SITE_URL}/profile/${encodeURIComponent(memberId)}/edit` : null
    },
    guildId: env.DISCORD_GUILD_ID?.trim() || null,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  })
  if (reminderSendAllowed(env)) await sweepOldCallSends(now).catch(() => 0)
  return result
}
