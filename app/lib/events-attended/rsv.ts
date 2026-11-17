/**
 * Keeps the stored rsv.pizza matches (MemberRsvEvent) fresh. Never called on profile view: triggers are
 * email verified/changed, wallet linked/unlinked, rsv.pizza account linked/unlinked, and the nightly cron.
 *
 * Identifiers sent to rsv.pizza: a sha256 of the member's VERIFIED profile email, a sha256 of the email
 * they proved on rsv.pizza through the account link, and their linked EVM wallets. Unverified emails never
 * match. A failed call leaves the stored rows alone.
 */
import { createHash } from 'crypto'
import { prisma } from '@/app/lib/db'
import { loadEventsAttendedConfig } from './config'
import { fetchGuestAttendance, GUEST_ATTENDANCE_MAX_HASHES, GUEST_ATTENDANCE_MAX_WALLETS } from './guest-attendance'

/** Same hash as the host-match contract: sha256 of the lower-cased, trimmed address. */
export const hashEmail = (email: string): string => createHash('sha256').update(email.trim().toLowerCase()).digest('hex')

export interface RsvIdentifiers {
  hashes: string[]
  wallets: string[]
}

type Db = Pick<typeof prisma, 'memberProfileExtras' | 'memberWallet'>

export async function collectIdentifiers(memberId: string, db: Db = prisma): Promise<RsvIdentifiers> {
  const [extras, wallets] = await Promise.all([
    db.memberProfileExtras.findUnique({
      where: { memberId },
      select: { email: true, emailVerifiedAt: true, rsvLinkedEmailHash: true },
    }),
    db.memberWallet.findMany({ where: { memberId, chainType: 'evm' }, select: { walletAddress: true }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }], take: GUEST_ATTENDANCE_MAX_WALLETS }),
  ])
  const hashes = new Set<string>()
  if (extras?.email && extras.emailVerifiedAt) hashes.add(hashEmail(extras.email))
  if (extras?.rsvLinkedEmailHash) hashes.add(extras.rsvLinkedEmailHash)
  return { hashes: [...hashes].slice(0, GUEST_ATTENDANCE_MAX_HASHES), wallets: wallets.map((w) => w.walletAddress) }
}

const sameIds = (a: RsvIdentifiers, b: RsvIdentifiers) =>
  JSON.stringify([[...a.hashes].sort(), [...a.wallets].map((w) => w.toLowerCase()).sort()]) === JSON.stringify([[...b.hashes].sort(), [...b.wallets].map((w) => w.toLowerCase()).sort()])

function parseDate(s: string | null): Date | null {
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

export type RefreshResult = { ok: true; count: number } | { ok: false }

/** Re-ask rsv.pizza and replace this member's stored events in one transaction. */
export async function refreshRsvEvents(memberId: string, opts: { fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv } = {}): Promise<RefreshResult> {
  const ids = await collectIdentifiers(memberId)
  if (ids.hashes.length === 0 && ids.wallets.length === 0) {
    await prisma.$transaction(async (tx) => {
      // Re-read inside the transaction: only wipe if the member still has nothing to match.
      const now = await collectIdentifiers(memberId, tx)
      if (now.hashes.length || now.wallets.length) return
      await tx.memberRsvEvent.deleteMany({ where: { memberId } })
      await tx.memberRsvCheck.deleteMany({ where: { memberId } })
    })
    return { ok: true, count: 0 }
  }

  const config = await loadEventsAttendedConfig()
  const found = await fetchGuestAttendance({ emailHashes: ids.hashes, wallets: ids.wallets }, { baseUrl: config.rsvApiUrl, env: opts.env, fetchImpl: opts.fetchImpl })
  if (!found) return { ok: false }
  const events = [...new Map(found.map((e) => [e.id, e])).values()]
  const now = new Date()
  const written = await prisma.$transaction(async (tx) => {
    // The identifiers may have changed while we waited on rsv.pizza (email changed, wallet removed):
    // those triggers refresh again, so do not write a result for the old ones.
    if (!sameIds(ids, await collectIdentifiers(memberId, tx))) return false
    await tx.memberRsvEvent.deleteMany({ where: { memberId } })
    await tx.memberRsvEvent.createMany({
      skipDuplicates: true,
      data: events.map((e) => ({
        memberId,
        rsvEventId: e.id,
        name: e.name,
        date: parseDate(e.date),
        city: e.city,
        url: e.url,
        matchedBy: e.matchedBy,
        guestListHidden: e.guestListHidden,
        fetchedAt: now,
      })),
    })
    await tx.memberRsvCheck.upsert({ where: { memberId }, create: { memberId, checkedAt: now }, update: { checkedAt: now } })
    return true
  })
  if (!written) return { ok: false }
  return { ok: true, count: events.length }
}

/** Trigger entry point: does nothing while the feature is off, and never throws. */
export async function refreshRsvEventsIfEnabled(memberId: string): Promise<void> {
  try {
    if (!(await loadEventsAttendedConfig()).enabled) return
    await refreshRsvEvents(memberId)
  } catch (err) {
    console.error('[events-attended] refresh failed', err instanceof Error ? err.message : 'error')
  }
}

/**
 * The address (or rsv.pizza link) changed or was removed: rows found through it must not linger.
 * Wallet-matched rows stay; the check marker goes so the nightly job re-checks soon.
 */
export async function clearEmailMatches(memberId: string): Promise<void> {
  await prisma.$transaction([
    prisma.memberRsvEvent.deleteMany({ where: { memberId, matchedBy: 'email' } }),
    prisma.memberRsvCheck.deleteMany({ where: { memberId } }),
  ])
}

/**
 * A wallet was removed: rows found only through wallets go now (email-matched rows stay), and the check
 * marker is reset so a failed background refresh is retried by the nightly job. The refresh re-adds
 * anything a remaining wallet still matches.
 */
export async function clearWalletMatches(memberId: string): Promise<void> {
  await prisma.$transaction([
    prisma.memberRsvEvent.deleteMany({ where: { memberId, matchedBy: 'wallet' } }),
    prisma.memberRsvCheck.deleteMany({ where: { memberId } }),
  ])
}

/** Members due for a nightly re-check: have an identifier, and no check newer than `recheckDays`. */
export async function listDueMembers(recheckDays: number, limit: number, now: Date = new Date()): Promise<string[]> {
  const cutoff = new Date(now.getTime() - recheckDays * 86_400_000)
  const [withEmail, withWallet] = await Promise.all([
    prisma.memberProfileExtras.findMany({
      where: { OR: [{ emailVerifiedAt: { not: null }, email: { not: null } }, { rsvLinkedEmailHash: { not: null } }] },
      select: { memberId: true },
    }),
    prisma.memberWallet.findMany({ where: { chainType: 'evm' }, select: { memberId: true }, distinct: ['memberId'] }),
  ])
  const candidates = [...new Set([...withEmail, ...withWallet].map((r) => r.memberId))]
  if (candidates.length === 0) return []
  const checks = await prisma.memberRsvCheck.findMany({ where: { memberId: { in: candidates } }, select: { memberId: true, checkedAt: true } })
  const last = new Map(checks.map((c) => [c.memberId, c.checkedAt.getTime()]))
  return candidates
    .filter((m) => (last.get(m) ?? 0) < cutoff.getTime())
    .sort((a, b) => (last.get(a) ?? 0) - (last.get(b) ?? 0))
    .slice(0, limit)
}
