/**
 * The nearby-event invite run (a phase of the reminders cron, every 30 minutes).
 *
 *  1. Fetch the curated upcoming events from rsv.pizza (one small request; any failure = nothing this run).
 *     No events in the lead window: stop, without reading members.
 *  2. Load members (the cached members table) and keep those whose city resolves to a map city within reach
 *     of an event. Invites are OPT-OUT: only members with a ReminderPref row of nearbyEvents=false (or no
 *     Discord id, or no placed city) are left out.
 *  3. Drop (member, event) pairs a previous run already handled. Off / preview: count what WOULD be sent.
 *  4. On: per pair, soonest event first: weekly and daily caps (a capped pair is NOT recorded, so it is
 *     invited to later if still open and in time), quiet hours in the member's timezone (also not recorded:
 *     the next run tries again), claim the (member, event) row BEFORE sending, send on the member's channel
 *     (Discord and/or Telegram), then create the in-app notification, record. A Discord 429 stops the run.
 *
 * Idempotent: the ReminderSend unique key makes a rerun a no-op. Logs and results carry counts only.
 */
import { DAY_MS, isKnownTimezone, isQuiet } from '@/app/lib/followups/quiet-hours'
import { deliverDm, deliverTelegram, reminderSendAllowed, type DmSender, type TelegramSender } from '@/app/lib/reminders/deliver'
import { canTryDm, type DmReach } from '@/app/lib/reminders/reach'
import { MAX_ATTEMPTS } from '@/app/lib/reminders/store'
import { canTryTelegram, type ReachRow, type RecheckCfg } from '@/app/lib/telegram/reach'
import { telegramSendAllowed, type DmFailureCode } from '@/app/lib/telegram/rsv-client'
import { createHash } from 'node:crypto'
import type { NearbyEvent } from './client'
import { capVerdict, distanceKm, eventInvitable, memberVerdict, type MatchConfig, type MemberPlace, type MemberPref } from './match'
import { nearbyComponents, nearbyTelegramButtons, nearbyText } from './messages'
import type { NearbyStore } from './store'

export interface QuietCfg {
  startHour: number
  endHour: number
  /** Unknown timezone: only this daytime UTC window sends (the complement is quiet). */
  unknownTzStartHour: number
  unknownTzEndHour: number
}

export interface NearbyRunConfig {
  enabled: boolean
  match: MatchConfig
  maxSends: number
  quiet: QuietCfg
  telegramRecheck: RecheckCfg
}

export interface NearbyRunResult {
  dryRun: boolean
  fetchFailed: boolean
  events: number
  /** Members within reach of at least one event (before opt-outs). */
  nearMembers: number
  /** (member, event) pairs wanted and not yet handled. */
  due: number
  sent: number
  skipped: Record<string, number>
  retried: number
  failed: number
  stoppedEarly: boolean
}

export type InviteMember = MemberPlace & { memberId: string }

export interface NearbyRunDeps {
  now: Date
  env: Record<string, string | undefined>
  config: NearbyRunConfig
  siteUrl: string
  fetchEvents: (until: Date) => Promise<NearbyEvent[] | null>
  loadMembers: () => Promise<InviteMember[]>
  store: NearbyStore
  getReach: (discordId: string) => Promise<DmReach | null>
  setClosed: (discordId: string, prev: DmReach | null, now: Date) => Promise<void>
  setOk: (discordId: string, now: Date) => Promise<void>
  send: DmSender
  getTelegram: (discordId: string) => Promise<{ telegramId: string; reach: ReachRow | null } | null>
  sendTelegram: TelegramSender
  recordTelegramReach: (telegramId: string, code: DmFailureCode | 'ok', cfg: RecheckCfg, now: Date) => Promise<void>
  notify: (o: { discordId: string; title: string; message: string; linkUrl: string; eventId: string }) => Promise<void>
  sleep: (ms: number) => Promise<void>
}

const PACE_MS = 250

const bump = (m: Record<string, number>, k: string) => {
  m[k] = (m[k] ?? 0) + 1
}

/** The Telegram idempotency key of one invite: hashed, so no member id appears in the proxy's logs. */
export const nearbyTelegramKey = (eventId: string, discordId: string): string =>
  `rm:${createHash('sha256').update(`reminder:nearby:${eventId}:${discordId}`).digest('hex').slice(0, 40)}`

/** Quiet hours for this member now. A known timezone uses the follow-up quiet hours; unknown, a daytime UTC window. */
export function nearbyQuiet(now: Date, timezone: string | null | undefined, q: QuietCfg): boolean {
  if (isKnownTimezone(timezone)) return isQuiet(now, timezone, q.startHour, q.endHour)
  return isQuiet(now, 'UTC', q.unknownTzEndHour, q.unknownTzStartHour)
}

interface Pair {
  m: InviteMember
  e: NearbyEvent
  km: number
}

export async function runNearbyInvites(d: NearbyRunDeps): Promise<NearbyRunResult> {
  const { now, config } = d
  const dryRun = !config.enabled || !reminderSendAllowed(d.env)
  const res: NearbyRunResult = { dryRun, fetchFailed: false, events: 0, nearMembers: 0, due: 0, sent: 0, skipped: {}, retried: 0, failed: 0, stoppedEarly: false }

  const fetched = await d.fetchEvents(new Date(now.getTime() + config.match.maxLeadDays * DAY_MS))
  if (!fetched) {
    res.fetchFailed = true
    return res
  }
  const events = fetched.filter((e) => eventInvitable(e, now, config.match)).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
  res.events = events.length
  if (!events.length) return res

  // Members who are anywhere near an event (at the widest radius a member can pick), before preferences.
  const members = await d.loadMembers()
  const coarseKm = Math.max(250, config.match.defaultRadiusKm) + config.match.citySlackKm
  const near = members.filter((m) => events.some((e) => distanceKm(m, e) <= coarseKm))
  res.nearMembers = near.length
  if (!near.length) return res

  const prefRows = await d.store.listPrefs(near.map((m) => m.discordId))
  const prefs = new Map<string, MemberPref & { channel: string }>(
    prefRows.map((r) => [r.discordId, { nearbyEvents: r.nearbyEvents, radiusKm: r.nearbyRadiusKm, channel: r.channel }]),
  )

  const handled = await d.store.handled(events.map((e) => e.id))
  const pairs: Pair[] = []
  for (const e of events) {
    for (const m of near) {
      const v = memberVerdict(m, prefs.get(m.discordId), e, config.match)
      if (!v.ok) {
        if (v.why === 'opted_out') bump(res.skipped, 'opted_out')
        continue
      }
      if (handled.has(`${m.discordId}|${e.id}`)) continue
      pairs.push({ m, e, km: v.km })
    }
  }
  res.due = pairs.length
  if (dryRun || !pairs.length) return res

  const ids = [...new Set(pairs.map((p) => p.m.discordId))]
  const history = await d.store.sentThisWeek(ids, now)
  const zones = await d.store.timezones([...new Set(pairs.map((p) => p.m.memberId))])
  const recheck = config.telegramRecheck
  let first = true

  for (const { m, e, km } of pairs) {
    if (res.sent >= config.maxSends) {
      res.stoppedEarly = true
      return res
    }
    const id = m.discordId
    const pref = prefs.get(id)
    // The member's reminder channel; AUTO (and no row) is Discord.
    const wantTelegram = pref?.channel === 'TELEGRAM' || pref?.channel === 'BOTH'
    const wantDiscord = !pref || pref.channel !== 'TELEGRAM'

    const cap = capVerdict(history.get(id) ?? [], now, config.match)
    if (cap !== 'ok') {
      bump(res.skipped, `cap_${cap}`)
      continue
    }
    if (nearbyQuiet(now, zones.get(m.memberId), config.quiet)) {
      bump(res.skipped, 'quiet')
      continue
    }

    const reach = wantDiscord ? await d.getReach(id) : null
    const discordOk = wantDiscord && canTryDm(reach, now)
    let tg: { telegramId: string } | null = null
    if (wantTelegram && telegramSendAllowed(d.env)) {
      const acct = await d.getTelegram(id).catch(() => null)
      if (acct && canTryTelegram(acct.reach, now)) tg = acct
    }

    const claim = await d.store.claim(id, e.id, 'NEARBY_EVENT')
    if (!claim.claimed) {
      bump(res.skipped, 'already')
      continue
    }
    if (!first) await d.sleep(PACE_MS)
    first = false

    const settingsUrl = `${d.siteUrl}/profile/${encodeURIComponent(m.memberId)}/edit`
    const text = nearbyText({ name: e.name, startsAt: e.startsAt, timezone: e.timezone, km, city: m.cityName, url: e.url })
    const delivered: string[] = []
    let retry: { code: string; countAttempt: boolean } | null = null
    let failCode: string | null = null

    if (discordOk) {
      const outcome = await deliverDm({ discordId: id, text, components: nearbyComponents(e.url, settingsUrl), send: d.send })
      switch (outcome.kind) {
        case 'sent':
          delivered.push('discord')
          await d.setOk(id, now).catch(() => undefined)
          break
        case 'closed':
          await d.setClosed(id, reach, now).catch(() => undefined)
          bump(res.skipped, 'dm_closed')
          break
        case 'rate_limited':
          // Nothing was posted: put it back for the next run and stop this one.
          await d.store.release(id, e.id, 'rate_limited', claim.attempts, false, 'NEARBY_EVENT')
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
    if (tg) {
      const outcome = await deliverTelegram({
        telegramUserId: tg.telegramId,
        text,
        buttons: nearbyTelegramButtons(e.url, settingsUrl),
        idempotencyKey: nearbyTelegramKey(e.id, id),
        send: d.sendTelegram,
      })
      switch (outcome.kind) {
        case 'sent':
          delivered.push('telegram')
          if (!outcome.replay) await d.recordTelegramReach(tg.telegramId, 'ok', recheck, now).catch(() => undefined)
          break
        case 'unreachable':
          if (!outcome.replay) await d.recordTelegramReach(tg.telegramId, outcome.code, recheck, now).catch(() => undefined)
          bump(res.skipped, 'telegram_unreachable')
          break
        case 'retry':
          retry = retry ?? { code: outcome.code, countAttempt: false }
          break
        case 'failed':
          failCode = failCode ?? outcome.code
          break
      }
    }

    // Nothing delivered and a retry is possible: release the claim (no in-app notice yet, so no duplicate later).
    if (!delivered.length && retry) {
      if (retry.countAttempt && claim.attempts + 1 >= MAX_ATTEMPTS) {
        await d.store.markFailed(id, e.id, retry.code, 'NEARBY_EVENT')
        res.failed++
      } else {
        await d.store.release(id, e.id, retry.code, claim.attempts, retry.countAttempt, 'NEARBY_EVENT')
        res.retried++
      }
      continue
    }

    // The in-app notification is always created once the invite is final (a closed DM still gets it).
    try {
      await d.notify({
        discordId: id,
        title: 'Pizza party near you',
        message: `${e.name}, about ${Math.max(1, Math.round(km))} km from ${m.cityName}`,
        linkUrl: e.url,
        eventId: e.id,
      })
      delivered.push('app')
    } catch {
      // best effort
    }

    if (delivered.length) {
      await d.store.markSent(id, e.id, 'NEARBY_EVENT', delivered.join(','))
      history.set(id, [...(history.get(id) ?? []), now])
      res.sent++
    } else if (failCode) {
      await d.store.markFailed(id, e.id, failCode, 'NEARBY_EVENT')
      res.failed++
    } else {
      await d.store.markSkipped(id, e.id, 'unreachable', 'NEARBY_EVENT')
      bump(res.skipped, 'unreachable')
    }
  }
  return res
}
