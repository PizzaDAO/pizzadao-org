/**
 * Optional host matching (plans/telegram-shared-bot.md, part 4): members with a verified email are
 * looked up on rsv.pizza by hash. A hit is only a SUGGESTION stored as a PENDING TelegramHostMatch;
 * nothing is ever sent to that Telegram account until the member and the Telegram holder both confirm
 * (host-match-consent.ts).
 *
 * Rules kept here:
 * - Only hashes of verified addresses leave the app; only a Telegram id and a 2-character hint return.
 * - A Telegram login always wins: members who linked through the widget are never matched, and a hit on
 *   a Telegram id that is already linked to or suggested for someone else is dropped (counted, never
 *   logged with ids).
 * - A member who has any match row (including DECLINED) is never asked again.
 * - Paced for rsv.pizza's limits: 100 hashes a request, one request every ~6.5 s (10 a minute), and a
 *   daily budget (telegram.hostMatchDailyHashes, below its 2000/day cap). On any limit the run just stops.
 */
import { createHash } from 'crypto'
import { prisma } from '@/app/lib/db'
import { getSheetData } from '@/app/lib/sheets/member-repository'
import { loadSettings } from '@/app/lib/settings'
import { resolveToggle } from '@/app/lib/settings/toggles'
import { HOST_MATCH_MAX_HASHES, hostMatch, telegramSendAllowed, type HostMatchFailure, type HostMatchResult } from './rsv-client'

type Env = Record<string, string | undefined>

const DAY_MS = 86_400_000
/** rsv.pizza allows 10 requests a minute. */
export const BATCH_GAP_MS = 6500
const DISCORD_ID_RE = /^\d{5,25}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** sha256 of the lower-cased, trimmed address, as 64 lowercase hex (what rsv.pizza compares). */
export const emailHash = (email: string): string => createHash('sha256').update(email.trim().toLowerCase()).digest('hex')

export interface HostMatchRun {
  skipped?: 'off' | 'budget' | 'nothing'
  candidates: number
  checked: number
  matched: number
  /** Hits dropped because the Telegram id is already linked or suggested for another member. */
  conflicts: number
  /** Why the run stopped early (a rsv.pizza limit or failure). */
  stopped?: HostMatchFailure
}

const empty = (skipped?: HostMatchRun['skipped']): HostMatchRun => ({ ...(skipped ? { skipped } : {}), candidates: 0, checked: 0, matched: 0, conflicts: 0 })

export interface RunOpts {
  now?: Date
  env?: Env
  /** Batches per run (the cron runs often; this keeps one run short). */
  maxBatches?: number
  sleep?: (ms: number) => Promise<void>
  match?: (hashes: string[]) => Promise<HostMatchResult>
}

interface Candidate {
  memberId: string
  discordId: string
  hash: string
}

/** Members with a verified email, a Discord id, no Telegram login, no earlier match and no recent check. */
async function listCandidates(now: Date, recheckDays: number, limit: number): Promise<Candidate[]> {
  const [extras, sheet] = await Promise.all([
    prisma.memberProfileExtras.findMany({ where: { email: { not: null }, emailVerifiedAt: { not: null } }, select: { memberId: true, email: true } }),
    getSheetData(),
  ])
  const found: Candidate[] = []
  for (const x of extras) {
    const email = (x.email ?? '').trim()
    const idx = sheet.memberToIdx.get(x.memberId)
    if (!EMAIL_RE.test(email) || idx === undefined) continue
    const discordId = String(sheet.rows[idx].discordId ?? '').trim()
    if (!DISCORD_ID_RE.test(discordId)) continue
    found.push({ memberId: x.memberId, discordId, hash: emailHash(email) })
  }
  if (found.length === 0) return []
  const ids = found.map((f) => f.discordId)
  const cutoff = new Date(now.getTime() - recheckDays * DAY_MS)
  const [accounts, matches, checks] = await Promise.all([
    prisma.telegramAccount.findMany({ where: { discordId: { in: ids } }, select: { discordId: true } }),
    prisma.telegramHostMatch.findMany({ where: { discordId: { in: ids } }, select: { discordId: true } }),
    prisma.telegramHostMatchCheck.findMany({ where: { memberId: { in: found.map((f) => f.memberId) }, checkedAt: { gte: cutoff } }, select: { memberId: true } }),
  ])
  const skipDiscord = new Set([...accounts, ...matches].map((r) => r.discordId))
  const recent = new Set(checks.map((c) => c.memberId))
  // One address shared by two members is ambiguous: ask for neither.
  const perHash = new Map<string, number>()
  for (const f of found) perHash.set(f.hash, (perHash.get(f.hash) ?? 0) + 1)
  return found.filter((f) => !skipDiscord.has(f.discordId) && !recent.has(f.memberId) && perHash.get(f.hash) === 1).sort((a, b) => a.memberId.localeCompare(b.memberId)).slice(0, limit)
}

/** Store one hit as a PENDING suggestion unless the Telegram id is spoken for. Returns what happened. */
async function storeHit(c: Candidate, telegramId: string, handleHint: string | null): Promise<'matched' | 'conflict'> {
  const [login, taken] = await Promise.all([
    prisma.telegramAccount.findUnique({ where: { telegramId }, select: { discordId: true } }),
    prisma.telegramHostMatch.findUnique({ where: { telegramId }, select: { discordId: true } }),
  ])
  if ((login && login.discordId !== c.discordId) || (taken && taken.discordId !== c.discordId)) return 'conflict'
  try {
    await prisma.telegramHostMatch.create({ data: { discordId: c.discordId, memberId: c.memberId, telegramId, handleHint, matchedBy: 'email', consent: 'PENDING' } })
    return 'matched'
  } catch (e) {
    // A unique race (the id or the member got a row in between): never overwrite an existing row.
    if ((e as { code?: string })?.code === 'P2002') return 'conflict'
    throw e
  }
}

export async function runHostMatch(opts: RunOpts = {}): Promise<HostMatchRun> {
  const now = opts.now ?? new Date()
  const env = opts.env ?? process.env
  const settings = await loadSettings()
  if (!telegramSendAllowed(env) || !resolveToggle('telegram.hostMatchEnabled', settings, env)) return empty('off')

  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const doneToday = await prisma.telegramHostMatchCheck.count({ where: { checkedAt: { gte: dayStart } } })
  const budget = settings.get('telegram.hostMatchDailyHashes') - doneToday
  if (budget <= 0) return empty('budget')

  const maxBatches = Math.max(1, opts.maxBatches ?? 3)
  const candidates = await listCandidates(now, settings.get('telegram.hostMatchRecheckDays'), Math.min(budget, maxBatches * HOST_MATCH_MAX_HASHES))
  if (candidates.length === 0) return empty('nothing')

  const lookup = opts.match ?? ((hashes: string[]) => hostMatch(hashes, { env }))
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const run: HostMatchRun = { candidates: candidates.length, checked: 0, matched: 0, conflicts: 0 }

  for (let i = 0; i < candidates.length; i += HOST_MATCH_MAX_HASHES) {
    if (i > 0) await sleep(BATCH_GAP_MS)
    const batch = candidates.slice(i, i + HOST_MATCH_MAX_HASHES)
    const r = await lookup([...new Set(batch.map((c) => c.hash))])
    if (!r.ok) {
      // A limit or an outage: stop here, nothing in this batch is marked checked, the next run continues.
      run.stopped = r.reason
      break
    }
    const byHash = new Map(r.matches.map((m) => [m.emailHash, m]))
    for (const c of batch) {
      const hit = byHash.get(c.hash)
      if (hit) {
        const outcome = await storeHit(c, hit.telegramUserId, hit.handleHint)
        if (outcome === 'matched') run.matched++
        else run.conflicts++
      }
      await prisma.telegramHostMatchCheck.upsert({ where: { memberId: c.memberId }, create: { memberId: c.memberId, checkedAt: now }, update: { checkedAt: now } })
      run.checked++
    }
  }
  return run
}
