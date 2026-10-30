/**
 * The city Telegram mirror outbox (plans/telegram-shared-bot.md, PR P3).
 *
 * Call recaps, pre-call agendas and the Community Call announcement are queued here AFTER the
 * Discord post was claimed, then sent by /api/cron/telegram-posts through the rsv.pizza proxy
 * (the app never holds the bot token). Rules:
 *
 * - enqueueMirror checks the switches and the send gate at queue time, so on a preview or while
 *   off nothing is even queued. It never throws: a Telegram problem must not touch the Discord post.
 * - processOutbox re-checks the private post filter per row (unreadable: leave the row pending),
 *   sends posts for one city strictly one at a time with a gap (the proxy has its own per-city
 *   floor), and never retries an `uncertain` outcome automatically.
 * - Idempotency key `tg:<row id>`: re-sending a row after a crash replays on the proxy.
 */
import { prisma } from '@/app/lib/db'
import { discordTextToPlainText } from '@/app/lib/discord-markup'
import { isCrewExcluded, loadPostFilter, mentionsBlockedTerm, type PostFilter } from '@/app/lib/calls/post-filters'
import { normalizeCrewId } from '@/app/lib/crew-id'
import { SITE_URL } from '@/app/lib/site-url'
import { loadSettings, type Settings } from '@/app/lib/settings'
import { resolveToggle, toggleEnabled, type ToggleKey } from '@/app/lib/settings/toggles'
import { parseCityKeys } from '@/app/lib/settings/telegram-settings'
import { cityPost, telegramSendAllowed, type CityPostResult } from './rsv-client'

export type MirrorKind = 'recap' | 'agenda' | 'announce'

const KIND_TOGGLE: Record<MirrorKind, ToggleKey> = {
  recap: 'telegram.recapMirrorEnabled',
  agenda: 'telegram.agendaMirrorEnabled',
  announce: 'telegram.announceMirrorEnabled',
}

/** The proxy rejects text over 3500 characters. */
export const MAX_POST_CHARS = 3500
export const MAX_ATTEMPTS = 5
/** A claim older than this is taken to be from a crashed run (the idempotency key keeps a re-send safe). */
const STALE_CLAIM_MS = 10 * 60 * 1000
/** Never faster than this between any two proxy calls (about 6 per second, far under Telegram's 30). */
const CALL_SPACING_MS = 150
const MAX_WAIT_MS = 15_000

/** Discord markup to the plain text the proxy sends: no mentions, no bold/italic markers, capped length. */
export function toPlainPost(text: string, link: string = SITE_URL): string {
  let t = discordTextToPlainText(text)
    .replace(/@(everyone|here)\b/gi, '')
    .replace(/\*\*|__|~~|`{1,3}/g, '')
    .replace(/(^|[\s(])\*(?=\S)([^*\n]+)\*(?=$|[\s).,!?])/g, '$1$2')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (t && !/https?:\/\//i.test(t)) t = `${t}\n\n${link}`
  if (t.length > MAX_POST_CHARS) t = `${t.slice(0, MAX_POST_CHARS - 1).trimEnd()}…`
  return t
}

/** The city keys a post of this kind goes to (empty = none). */
export function targetCityKeys(kind: MirrorKind, crewId: string | null | undefined, settings: Settings): string[] {
  if (kind === 'announce') return [...new Set((settings.get('telegram.announceCityKeys') as string[]).map((k) => k.trim().toLowerCase()).filter(Boolean))]
  const want = normalizeCrewId(crewId)
  if (!want) return []
  const row = (settings.get('telegram.crewCityGroups') as Array<{ crewId: string; cityKeys: string }>).find((r) => normalizeCrewId(r.crewId) === want)
  return row ? parseCityKeys(row.cityKeys) : []
}

export interface EnqueueInput {
  kind: MirrorKind
  /** CallRecording.id | `${eventId}:${startsAt ISO}` | the announce date key. */
  sourceId: string
  crewId?: string | null
  /** The crew's label, kept for the send-time exclusion check. */
  crewLabel?: string | null
  /** The Discord text (markup is converted here). */
  text: string
  /** Agendas: the event start. Others: now + telegram.postMaxAgeHours. */
  expiresAt?: Date
}

export interface EnqueueResult {
  queued: number
  reason?: 'send-off' | 'switch-off' | 'no-cities' | 'empty' | 'error'
}

/** Queue a mirror of an already-claimed Discord post. Never throws. */
export async function enqueueMirror(input: EnqueueInput, env: Record<string, string | undefined> = process.env, now: Date = new Date()): Promise<EnqueueResult> {
  try {
    if (!telegramSendAllowed(env)) return { queued: 0, reason: 'send-off' }
    const settings = await loadSettings()
    if (!resolveToggle('telegram.cityPostsEnabled', settings, env) || !resolveToggle(KIND_TOGGLE[input.kind], settings, env)) {
      return { queued: 0, reason: 'switch-off' }
    }
    const cities = targetCityKeys(input.kind, input.crewId, settings)
    if (cities.length === 0) return { queued: 0, reason: 'no-cities' }
    const text = toPlainPost(input.text)
    if (!text) return { queued: 0, reason: 'empty' }
    const expiresAt = input.expiresAt ?? new Date(now.getTime() + (settings.get('telegram.postMaxAgeHours') as number) * 3_600_000)
    const r = await prisma.telegramGroupPost.createMany({
      data: cities.map((cityKey) => ({
        kind: input.kind,
        sourceId: input.sourceId.slice(0, 120),
        crewId: input.crewId ? input.crewId.slice(0, 64) : null,
        crewLabel: input.crewLabel ? input.crewLabel.slice(0, 120) : null,
        cityKey,
        text,
        expiresAt,
      })),
      skipDuplicates: true,
    })
    return { queued: r.count }
  } catch (err) {
    console.error('[telegram/city-posts] enqueue failed:', err instanceof Error ? err.message : err)
    return { queued: 0, reason: 'error' }
  }
}

export interface ProcessDeps {
  post?: typeof cityPost
  sleep?: (ms: number) => Promise<void>
  now?: () => Date
  env?: Record<string, string | undefined>
  budgetMs?: number
  loadFilter?: () => Promise<PostFilter>
}

export interface ProcessResult {
  status: 'disabled' | 'ran'
  sent: number
  skipped: number
  failed: number
  uncertain: number
  deferred: number
  /** Set when the run stopped early because the proxy is not usable (rows stay pending). */
  stopped?: string
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Send due rows. Safe to run concurrently with itself (rows are claimed first). */
export async function processOutbox(deps: ProcessDeps = {}): Promise<ProcessResult> {
  const env = deps.env ?? process.env
  const clock = deps.now ?? (() => new Date())
  const sleep = deps.sleep ?? wait
  const post = deps.post ?? cityPost
  const result: ProcessResult = { status: 'ran', sent: 0, skipped: 0, failed: 0, uncertain: 0, deferred: 0 }
  if (!telegramSendAllowed(env) || !(await toggleEnabled('telegram.cityPostsEnabled', env))) return { ...result, status: 'disabled' }

  const settings = await loadSettings()
  const maxSends = settings.get('telegram.maxSendsPerRun') as number
  const gapMs = (settings.get('telegram.groupGapSeconds') as number) * 1000
  const started = clock().getTime()
  const deadline = started + (deps.budgetMs ?? 200_000)

  // Rows that waited too long are dropped, not sent late.
  const expired = await prisma.telegramGroupPost.updateMany({
    where: { status: 'PENDING', expiresAt: { lte: clock() } },
    data: { status: 'SKIPPED', code: 'expired', claimedAt: null },
  })
  result.skipped += expired.count

  // Only kinds whose switch is on now, so disabled-kind rows cannot crowd out enabled ones in the window.
  const kinds = (Object.keys(KIND_TOGGLE) as MirrorKind[]).filter((k) => resolveToggle(KIND_TOGGLE[k], settings, env))
  if (kinds.length === 0) return result
  const due = await prisma.telegramGroupPost.findMany({
    where: {
      status: 'PENDING',
      kind: { in: kinds },
      AND: [
        { OR: [{ sendAfter: null }, { sendAfter: { lte: clock() } }] },
        { OR: [{ claimedAt: null }, { claimedAt: { lt: new Date(clock().getTime() - STALE_CLAIM_MS) } }] },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: maxSends * 4,
  })
  if (due.length === 0) return result

  // Each city's last send, so a gap carries across runs.
  const recent = await prisma.telegramGroupPost.groupBy({
    by: ['cityKey'],
    where: { sentAt: { gte: new Date(started - 60 * 60 * 1000) } },
    _max: { sentAt: true },
  })
  const lastAt = new Map<string, number>()
  for (const r of recent) if (r._max.sentAt) lastAt.set(r.cityKey, r._max.sentAt.getTime())

  let filter: PostFilter
  try {
    filter = await (deps.loadFilter ?? loadPostFilter)()
  } catch (err) {
    // Fail-safe: the filter cannot be read, so send nothing this run (rows stay pending).
    console.error('[telegram/city-posts] post filter unavailable, not sending:', err instanceof Error ? err.message : err)
    return { ...result, stopped: 'filter-unavailable' }
  }

  let calls = 0
  let lastCallAt = 0
  // Cities with a row deferred or claimed by another run: all their later rows wait too, so posts
  // to one city stay in order and never overlap with a concurrent run.
  const busy = new Set<string>()
  for (const row of due) {
    if (busy.has(row.cityKey)) {
      result.deferred += 1
      continue
    }
    // A switch turned off since queueing leaves the row PENDING (it expires if it stays off).
    if (!resolveToggle(KIND_TOGGLE[row.kind as MirrorKind] ?? 'telegram.cityPostsEnabled', settings, env)) {
      result.deferred += 1
      continue
    }
    if (calls >= maxSends) {
      result.deferred += 1
      continue
    }
    if (clock().getTime() >= deadline) {
      result.deferred += 1
      continue
    }
    // The post filter may have changed since the row was queued.
    if ((row.crewId && isCrewExcluded({ id: row.crewId, label: row.crewLabel ?? row.crewId }, filter)) || mentionsBlockedTerm(row.text, filter)) {
      await prisma.telegramGroupPost.updateMany({ where: { id: row.id, status: 'PENDING' }, data: { status: 'SKIPPED', code: 'filtered', claimedAt: null } })
      result.skipped += 1
      continue
    }
    // One city at a time with a gap: wait it out when short, else leave the row for the next run.
    const sinceCity = clock().getTime() - (lastAt.get(row.cityKey) ?? 0)
    if (sinceCity < gapMs) {
      const need = gapMs - sinceCity
      if (need > MAX_WAIT_MS || clock().getTime() + need >= deadline) {
        busy.add(row.cityKey)
        result.deferred += 1
        continue
      }
      await sleep(need)
    }
    const sinceCall = clock().getTime() - lastCallAt
    if (sinceCall < CALL_SPACING_MS) await sleep(CALL_SPACING_MS - sinceCall)

    const claim = await prisma.telegramGroupPost.updateMany({
      where: {
        id: row.id,
        status: 'PENDING',
        OR: [{ claimedAt: null }, { claimedAt: { lt: new Date(clock().getTime() - STALE_CLAIM_MS) } }],
      },
      data: { claimedAt: clock(), attempts: { increment: 1 } },
    })
    if (claim.count !== 1) {
      // Another run holds this row (and so this city right now): leave the city to it.
      busy.add(row.cityKey)
      result.deferred += 1
      continue
    }

    calls += 1
    lastCallAt = clock().getTime()
    lastAt.set(row.cityKey, lastCallAt)
    const attempts = row.attempts + 1
    let out: CityPostResult
    try {
      out = await post({ cityKey: row.cityKey, text: row.text, idempotencyKey: `tg:${row.id}` }, { env })
    } catch {
      out = { ok: false, code: 'uncertain' }
    }
    const finish = (data: Record<string, unknown>) => prisma.telegramGroupPost.update({ where: { id: row.id }, data: { claimedAt: null, ...data } })

    if (out.ok) {
      await finish({ status: 'SENT', sentAt: clock(), messageId: out.messageId ?? null, code: null })
      result.sent += 1
      continue
    }
    switch (out.code) {
      case 'rate_limited':
        if (attempts >= MAX_ATTEMPTS) {
          await finish({ status: 'FAILED', code: 'rate_limited' })
          result.failed += 1
        } else {
          const delay = Math.max(('retryAfter' in out && out.retryAfter ? out.retryAfter : 0) * 1000, gapMs)
          await finish({ sendAfter: new Date(clock().getTime() + delay), code: 'rate_limited' })
          busy.add(row.cityKey)
          result.deferred += 1
        }
        break
      case 'no_group':
      case 'kicked':
        await finish({ status: 'SKIPPED', code: out.code })
        result.skipped += 1
        break
      case 'uncertain':
        // The message may have been delivered: never retried automatically.
        await finish({ status: 'UNCERTAIN', code: 'uncertain' })
        result.uncertain += 1
        break
      case 'bad_request':
        await finish({ status: 'FAILED', code: out.code })
        result.failed += 1
        break
      default:
        // not_configured | disabled | unavailable: the proxy is not usable right now.
        // Nothing was sent, so keep the row pending (and do not count the attempt) and stop the run.
        await prisma.telegramGroupPost.update({
          where: { id: row.id },
          data: { claimedAt: null, attempts: { decrement: 1 }, code: out.code },
        })
        result.deferred += 1
        result.stopped = out.code
        return result
    }
  }
  return result
}
