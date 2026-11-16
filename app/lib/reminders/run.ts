/**
 * The reminders run, every minute (call reminders by Discord and/or Telegram DM).
 *
 *  1. Load the opted-in members first (none: no Discord request at all).
 *  2. Find the call occurrences within the longest lead (Discord scheduled events, see schedule.ts).
 *  3. Pair each with the members who want it and for whom it is due by their own lead: their crews, the
 *     Community Call, and (MY_CREWS) any due call they marked Interested on Discord.
 *  4. Off (toggle off, or not production): count what WOULD be sent and log counts only. Nothing is claimed.
 *  5. On: per pair, check reach on the chosen channel(s) and the daily cap, claim the (member, occurrence)
 *     row BEFORE sending (one claim covers both channels, so a run every minute never double-sends), send,
 *     record. Sent if any channel delivered. A Discord 403 marks the member CLOSED (backoff); a Discord 429
 *     stops the run; an uncertain failure with nothing delivered releases the claim (at most 3 attempts;
 *     the Telegram idempotency key turns a retried Telegram send into a replay).
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
import { prisma } from '@/app/lib/db'
import { canTryTelegram, loadReach, recordResult, type ReachRow, type RecheckCfg } from '@/app/lib/telegram/reach'
import { sendDm, telegramSendAllowed, type DmFailureCode } from '@/app/lib/telegram/rsv-client'
import { deliverDm, deliverTelegram, reminderSendAllowed, telegramKeyFor, type DmSender, type TelegramSender } from './deliver'
import { fetchInterestedUserIds } from './interested'
import { callReminderComponents, callReminderTelegramButtons, callReminderTelegramText, callReminderText } from './messages'
import { canTryDm, loadDmReach, recordDmClosed, recordDmOk, type DmReach } from './reach'
import {
  HORIZON_SLACK_MS,
  SAME_EVENT_WINDOW_MS,
  channelsOf,
  crewIdsFromCell,
  dueOccurrences,
  isDue,
  leadMsFor,
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
  /** Telegram "not started" backoff (the same settings the follow-ups use); defaults 7 / 60 days. */
  telegramRecheck?: RecheckCfg
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
  /** Of `sent`, how many went out on Telegram (alone or with Discord). */
  sentTelegram: number
  /** Pairs added because the member marked the call Interested on Discord. */
  viaInterested: number
  /** Interested lookups that failed (those pairs fell back to crews). */
  interestedFailed: number
}

export interface RunDeps {
  now: Date
  env: Record<string, string | undefined>
  config: RunConfig
  store: ReminderStore
  loadOccurrences: (o: { now: Date; horizonMs: number; leadMs: number }) => Promise<CallOccurrence[]>
  /** The crew ids in the member's own row (for MY_CREWS), resolved at send time. */
  memberCrewIds: (discordId: string) => Promise<string[]>
  /** The members who marked this event Interested on Discord. May throw: the run then uses crews only. */
  interestedIds: (eventId: string) => Promise<Set<string>>
  /** The member's linked Telegram account and its reach, or null when not linked. */
  getTelegram: (discordId: string) => Promise<{ telegramId: string; reach: ReachRow | null } | null>
  sendTelegram: TelegramSender
  recordTelegramReach: (telegramId: string, code: DmFailureCode | 'ok', cfg: RecheckCfg, now: Date) => Promise<void>
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
const DEFAULT_RECHECK: RecheckCfg = { dmRecheckDays: 7, dmRecheckMaxDays: 60 }

const bump = (m: Record<string, number>, k: string) => {
  m[k] = (m[k] ?? 0) + 1
}

export async function runCallReminders(d: RunDeps): Promise<RunResult> {
  const { now, config } = d
  const dryRun = !config.enabled || !reminderSendAllowed(d.env)
  const res: RunResult = { dryRun, occurrences: 0, due: 0, sent: 0, skipped: {}, retried: 0, failed: 0, stoppedEarly: false, sentTelegram: 0, viaInterested: 0, interestedFailed: 0 }

  // Members first: it runs every minute, and with nobody opted in there is no reason to ask Discord anything.
  const prefs = await d.store.listCallPrefs()
  if (!prefs.length) return res
  const maxLeadMs = Math.max(...prefs.map((p) => leadMsFor(p, config.leadMinutes)))
  const occurrences = await d.loadOccurrences({ now, horizonMs: maxLeadMs + HORIZON_SLACK_MS, leadMs: maxLeadMs })
  res.occurrences = occurrences.length
  if (!occurrences.length) return res

  // (member, occurrence) pairs, soonest call first. Each is due by the member's own lead.
  const crewMemo = new Map<string, Promise<string[]>>()
  const crewsOf = (id: string) => {
    let p = crewMemo.get(id)
    if (!p) crewMemo.set(id, (p = d.memberCrewIds(id).catch(() => [])))
    return p
  }
  // Interested lists are fetched only for an occurrence that a MY_CREWS member is due for and would not otherwise get.
  const interestedMemo = new Map<string, Promise<Set<string>>>()
  const interestedOf = (eventId: string) => {
    let p = interestedMemo.get(eventId)
    if (!p) {
      interestedMemo.set(
        eventId,
        (p = d.interestedIds(eventId).catch(() => {
          res.interestedFailed++
          return new Set<string>()
        })),
      )
    }
    return p
  }
  const pairs: Array<{ pref: PrefLite; occ: CallOccurrence }> = []
  for (const occ of occurrences) {
    for (const pref of prefs) {
      if (!isDue(occ.startsAt, now, leadMsFor(pref, config.leadMinutes))) continue
      const mine = pref.calls === 'MY_CREWS' ? await crewsOf(pref.discordId) : []
      if (wantsCrew(pref, occ.crewId, mine)) {
        pairs.push({ pref, occ })
      } else if (pref.calls === 'MY_CREWS' && (await interestedOf(occ.eventId)).has(pref.discordId)) {
        pairs.push({ pref, occ })
        res.viaInterested++
      }
    }
  }
  res.due = pairs.length
  if (dryRun || !pairs.length) return res

  const memberIds = [...new Set(pairs.map((p) => p.pref.discordId))]
  // Pairs a previous run already dealt with: skipped without further reads (this run happens every minute).
  const handled = await d.store.handledCalls(memberIds, [...new Set(pairs.map((p) => p.occ.refKey))])
  const sentToday = await d.store.sentSince(memberIds, new Date(now.getTime() - DAY_MS))
  const sameEvent = await d.store.sentForEventsSince(
    memberIds,
    [...new Set(pairs.map((p) => p.occ.eventId))],
    new Date(now.getTime() - SAME_EVENT_WINDOW_MS),
  )
  const recheck = config.telegramRecheck ?? DEFAULT_RECHECK
  let first = true

  for (const { pref, occ } of pairs) {
    if (res.sent >= config.maxSendsPerRun) {
      res.stoppedEarly = true
      break
    }
    const id = pref.discordId
    if (handled.has(`${id}|${occ.refKey}`)) {
      bump(res.skipped, 'already')
      continue
    }
    const want = channelsOf(pref)

    // Discord: closed DMs get one attempt, then quiet until the backoff passes.
    const reach = want.discord ? await d.getReach(id) : null
    const discordOk = want.discord && canTryDm(reach, now)
    if (want.discord && !discordOk) bump(res.skipped, 'dm_closed')
    // Telegram: needs a linked account the bot can reach, and the sender configured.
    let tg: { telegramId: string } | null = null
    if (want.telegram) {
      if (!telegramSendAllowed(d.env)) bump(res.skipped, 'telegram_off')
      else {
        const acct = await d.getTelegram(id).catch(() => null)
        if (!acct) bump(res.skipped, 'telegram_no_link')
        else if (!canTryTelegram(acct.reach, now)) bump(res.skipped, 'telegram_unreachable')
        else tg = acct
      }
    }
    if (!discordOk && !tg) continue
    // Daily cap, all reminder kinds together.
    const cap = capDecision(sentToday.get(id) ?? [], now, config.maxPerMemberPerDay)
    if (!cap.ok) {
      bump(res.skipped, 'cap')
      continue
    }
    // A moved call already reminded for: one DM per event until the "time changed" correction exists.
    if (sameEvent.has(`${id}|${occ.eventId}`)) {
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

    const settingsUrl = await d.settingsUrl(id).catch(() => null)
    const sentVia: string[] = []
    let discordClosed = false
    let retry: { code: string; countAttempt: boolean } | null = null
    let failCode: string | null = null

    if (discordOk) {
      const text = callReminderText({ crewLabel: occ.crewLabel, startsAt: occ.startsAt, guildId: d.guildId, eventId: occ.eventId })
      const outcome = await deliverDm({ discordId: id, text, components: callReminderComponents(settingsUrl), send: d.send })
      switch (outcome.kind) {
        case 'sent':
          sentVia.push('discord')
          await d.setOk(id, now).catch(() => undefined)
          break
        case 'closed':
          discordClosed = true
          await d.setClosed(id, reach, now).catch(() => undefined)
          break
        case 'rate_limited':
          // Nothing was posted (Discord goes first): put it back for the next run and stop this one.
          await d.store.release(id, occ.refKey, 'rate_limited', claim.attempts, false)
          res.stoppedEarly = true
          return res
        case 'retry':
          retry = { code: outcome.code, countAttempt: true }
          break
        case 'failed':
          failCode = outcome.code
          break
      }
    }

    let telegramUnreachable = false
    if (tg) {
      const outcome = await deliverTelegram({
        telegramUserId: tg.telegramId,
        text: callReminderTelegramText({ crewLabel: occ.crewLabel, startsAt: occ.startsAt, now, guildId: d.guildId, eventId: occ.eventId }),
        buttons: callReminderTelegramButtons(settingsUrl),
        idempotencyKey: telegramKeyFor(occ.refKey, id),
        send: d.sendTelegram,
      })
      switch (outcome.kind) {
        case 'sent':
          sentVia.push('telegram')
          // A replayed answer is old news: never let it overwrite fresher reach information.
          if (!outcome.replay) await d.recordTelegramReach(tg.telegramId, 'ok', recheck, now).catch(() => undefined)
          break
        case 'unreachable':
          telegramUnreachable = true
          if (!outcome.replay) await d.recordTelegramReach(tg.telegramId, outcome.code, recheck, now).catch(() => undefined)
          break
        case 'retry':
          retry = { code: outcome.code, countAttempt: (retry?.countAttempt ?? false) || outcome.countAttempt }
          break
        case 'failed':
          failCode = failCode ?? outcome.code
          break
      }
    }

    if (sentVia.length) {
      // Any channel delivering is a send: a partial success is never retried (it could double-post).
      await d.store.markSent(id, occ.refKey, 'CALL', sentVia.join(','))
      sentToday.set(id, [...(sentToday.get(id) ?? []), now])
      res.sent++
      if (sentVia.includes('telegram')) res.sentTelegram++
    } else if (retry) {
      if (retry.countAttempt && claim.attempts + 1 >= MAX_ATTEMPTS) {
        await d.store.markFailed(id, occ.refKey, retry.code)
        res.failed++
      } else {
        await d.store.release(id, occ.refKey, retry.code, claim.attempts, retry.countAttempt)
        res.retried++
      }
    } else if (failCode) {
      await d.store.markFailed(id, occ.refKey, failCode)
      res.failed++
    } else {
      // Every chosen channel answered "cannot reach": quiet until its backoff passes.
      const code = discordClosed ? 'dm_closed' : telegramUnreachable ? 'telegram_unreachable' : 'unreachable'
      await d.store.markSkipped(id, occ.refKey, code)
      bump(res.skipped, code)
    }
  }
  return res
}

/** The real wiring, used by the cron route. */
export async function runCallRemindersNow(
  now = new Date(),
  env: Record<string, string | undefined> = process.env,
  opts: { dryRun?: boolean } = {},
): Promise<RunResult | { skipped: 'disabled' }> {
  // Off (switch, env kill, or any non-production deploy): no Discord fetch, no database reads. The
  // preview check is first so a preview never even reads settings. `dryRun` (cron route ?dryRun=1)
  // runs the full counting path on demand, still sending nothing.
  const live = reminderSendAllowed(env) && (await toggleEnabled('reminders.callsEnabled', env))
  if (!live && !opts.dryRun) return { skipped: 'disabled' }
  const settings = await loadSettings()
  const config: RunConfig = {
    enabled: live && !opts.dryRun,
    leadMinutes: settings.get('reminders.callLeadMinutes'),
    maxSendsPerRun: settings.get('reminders.maxSendsPerRun'),
    maxPerMemberPerDay: settings.get('reminders.maxPerMemberPerDay'),
    telegramRecheck: { dmRecheckDays: settings.get('telegram.dmRecheckDays'), dmRecheckMaxDays: settings.get('telegram.dmRecheckMaxDays') },
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
    interestedIds: (eventId) => fetchInterestedUserIds(eventId, { env: env as NodeJS.ProcessEnv }),
    getTelegram: async (discordId) => {
      const acct = await prisma.telegramAccount.findUnique({ where: { discordId }, select: { telegramId: true } })
      return acct ? { telegramId: acct.telegramId, reach: await loadReach(acct.telegramId) } : null
    },
    sendTelegram: (a) => sendDm(a),
    recordTelegramReach: (telegramId, code, cfg, at) => recordResult(telegramId, code, cfg, at),
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
