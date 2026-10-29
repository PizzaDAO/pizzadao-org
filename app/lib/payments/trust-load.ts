/**
 * Loads the inputs for trust.ts from the database and the party platform, and runs them. Every
 * source is best effort and falls to its safe value: a lookup that fails counts as "not qualified".
 */
import { prisma } from '@/app/lib/db'
import { getCurrentLevel } from '@/app/lib/missions'
import { snowflakeCreatedAt } from '@/app/lib/mission-verify/policy'
import type { PaymentPolicy } from './policy'
import { fetchRsvTrack, rsvConfig, type RsvIdentifiers, type RsvTrack } from './rsv-track'
import { evaluateTrust, toHostView, type HostView, type TrustInput, type TrustResult } from './trust'

const YEAR = 365 * 86_400_000

// The member's progress card must not wait on the party platform every time the page loads: it uses the
// last answer this server instance saw (from a check run), or none.
const RSV_CACHE_MS = 10 * 60_000
const rsvCache = new Map<string, { at: number; v: RsvTrack | null }>()
export function cachedRsv(discordId: string, now = Date.now()): RsvTrack | null | undefined {
  const hit = rsvCache.get(discordId)
  return hit && now - hit.at < RSV_CACHE_MS ? hit.v : undefined
}
export function __clearRsvCache() {
  rsvCache.clear()
}

async function rsvIdentifiers(discordId: string): Promise<RsvIdentifiers> {
  const [wallets, telegram] = await Promise.all([
    prisma.memberWallet.findMany({ where: { discordId }, select: { walletAddress: true }, take: 10 }).catch(() => [] as Array<{ walletAddress: string }>),
    prisma.telegramAccount.findUnique({ where: { discordId }, select: { username: true } }).catch(() => null),
  ])
  return {
    wallets: [...new Set(wallets.map((w: { walletAddress: string }) => w.walletAddress.trim()).filter(Boolean))] as string[],
    telegrams: telegram?.username ? [telegram.username.replace(/^@/, '')] : [],
  }
}

export async function loadTrustInput(
  discordId: string,
  opts: { excludeRequestId?: string; now?: Date; rsv?: RsvTrack | null | 'skip' } = {},
): Promise<TrustInput> {
  const now = opts.now ?? new Date()
  const notThis = opts.excludeRequestId ? { id: { not: opts.excludeRequestId } } : {}
  const [paid, fraud, level, open, rsv] = await Promise.all([
    prisma.paymentRequest.count({ where: { requesterDiscordId: discordId, status: 'PAID', ...notThis } }).catch(() => 0),
    prisma.paymentRequest
      .findFirst({ where: { requesterDiscordId: discordId, rejectedAsFraud: true, createdAt: { gte: new Date(now.getTime() - YEAR) } }, select: { id: true } })
      .then((r: { id: string } | null) => !!r)
      .catch(() => true), // unknown: assume the worst
    getCurrentLevel(discordId).catch(() => 0),
    prisma.paymentRequest
      .findMany({ where: { requesterDiscordId: discordId, status: { in: ['RECEIVED', 'NEEDS_INFO'] }, ...notThis }, select: { flags: true }, take: 20 })
      .catch(() => null),
    opts.rsv !== undefined && opts.rsv !== 'skip'
      ? Promise.resolve(opts.rsv)
      : opts.rsv === 'skip' || !rsvConfig()
        ? Promise.resolve(null)
        : rsvIdentifiers(discordId)
            .then((ids) => fetchRsvTrack(ids))
            .then((v) => {
              if (rsvCache.size > 2000) rsvCache.clear()
              rsvCache.set(discordId, { at: Date.now(), v })
              return v
            }),
  ])
  return {
    now,
    rsv,
    paidWithProof: paid,
    fraudRejectedLast12Months: fraud,
    accountCreatedAt: snowflakeCreatedAt(discordId),
    level: typeof level === 'number' ? level : 0,
    // If the lookup failed, assume there is an open high flag.
    openHighFlagElsewhere: open === null || open.some((r: { flags: unknown }) => Array.isArray(r.flags) && (r.flags as Array<{ severity?: string }>).some((f) => f.severity === 'high')),
  }
}

export async function trustFor(discordId: string, policy: PaymentPolicy, opts: Parameters<typeof loadTrustInput>[1] = {}): Promise<{ input: TrustInput; result: TrustResult }> {
  const input = await loadTrustInput(discordId, opts)
  return { input, result: evaluateTrust(input, policy) }
}

/** The requester-safe progress card. */
export async function hostViewFor(discordId: string, policy: PaymentPolicy): Promise<HostView> {
  // Page loads never call the party platform: cached answer or none.
  const { input, result } = await trustFor(discordId, policy, { rsv: cachedRsv(discordId) ?? 'skip' })
  return toHostView(result, input, policy)
}
