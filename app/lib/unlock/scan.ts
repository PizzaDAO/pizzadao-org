/**
 * Scan members' wallets for keys on the enabled Unlock locks and keep UnlockKey in step.
 *
 * Safety rule: the subgraph is read FIRST and the database written only if every read worked. Any
 * failure throws before a single key is written or marked gone, so an outage can never turn into
 * "this member has 0 tickets".
 */
import { prisma } from '@/app/lib/db'
import { getSetting } from '@/app/lib/settings'
import { CHAINS, fetchKeys } from './subgraph'
import { ADDRESS_RE, eventUrl, normAddress } from './locks'

export interface FoundKey {
  networkId: number
  lockAddress: string
  tokenId: string
  owner: string
  memberId: string
}

export interface ExistingKey {
  id: number
  memberId: string
  networkId: number
  lockAddress: string
  tokenId: string
  owner: string
  gone: boolean
}

export const keyId = (k: { networkId: number; lockAddress: string; tokenId: string; owner: string }) =>
  `${k.networkId}:${k.lockAddress}:${k.tokenId}:${k.owner}`

/**
 * owner (lowercase) -> memberId. A wallet linked to several members belongs to the first one
 * (lowest wallet row id), because a key can only be counted once.
 */
export function buildOwnerMap(
  rows: Array<{ id: number; memberId: string; walletAddress: string }>,
  extra: Array<{ memberId: string; wallet: string }> = [],
): Map<string, string> {
  const map = new Map<string, string>()
  for (const r of [...rows].sort((a, b) => a.id - b.id)) {
    const a = normAddress(r.walletAddress)
    if (ADDRESS_RE.test(a) && !map.has(a)) map.set(a, r.memberId)
  }
  for (const e of extra) {
    const a = normAddress(e.wallet)
    if (ADDRESS_RE.test(a) && !map.has(a)) map.set(a, e.memberId)
  }
  return map
}

export interface KeyPlan {
  create: FoundKey[]
  /** Rows seen again: refresh lastSeenAt, clear gone. */
  touchIds: number[]
  /** Rows seen again under a different member (wallet moved): reassign. */
  reassign: Array<{ id: number; memberId: string }>
  /** Rows no longer held (transferred away or cancelled), for scanned locks only. */
  goneIds: number[]
}

/** Diff what the subgraph says against what we have. Pure. */
export function planKeys(existing: ExistingKey[], found: FoundKey[], memberIds: Set<string>, scannedLocks: Set<string>): KeyPlan {
  const have = new Map(existing.map((e) => [keyId(e), e]))
  const foundIds = new Set<string>()
  const plan: KeyPlan = { create: [], touchIds: [], reassign: [], goneIds: [] }
  for (const f of found) {
    const id = keyId(f)
    if (foundIds.has(id)) continue
    foundIds.add(id)
    const e = have.get(id)
    if (!e) plan.create.push(f)
    else {
      plan.touchIds.push(e.id)
      if (e.memberId !== f.memberId) plan.reassign.push({ id: e.id, memberId: f.memberId })
    }
  }
  for (const e of existing) {
    if (e.gone || foundIds.has(keyId(e)) || !memberIds.has(e.memberId)) continue
    if (scannedLocks.has(`${e.networkId}:${e.lockAddress}`)) plan.goneIds.push(e.id)
  }
  return plan
}

export interface ScanResult {
  members: number
  wallets: number
  found: number
  created: number
  gone: number
}

/** Fetch every chain's keys for the owners, or throw. Nothing is written here. */
export async function fetchFound(ownerMap: Map<string, string>, locksByNet: Map<number, string[]>): Promise<FoundKey[]> {
  const owners = [...ownerMap.keys()]
  const found: FoundKey[] = []
  if (owners.length === 0) return found
  for (const [networkId, locks] of locksByNet) {
    if (locks.length === 0) continue
    for (const k of await fetchKeys(networkId, owners, locks)) {
      if (k.cancelled) continue
      const owner = normAddress(k.owner)
      const memberId = ownerMap.get(owner)
      if (!memberId) continue
      found.push({ networkId, lockAddress: normAddress(k.lock.id), tokenId: String(k.tokenId), owner, memberId })
    }
  }
  return found
}

async function enabledLocksByNet(): Promise<Map<number, string[]>> {
  const locks = await prisma.unlockLock.findMany({ where: { enabled: true }, select: { networkId: true, address: true } })
  const m = new Map<number, string[]>()
  for (const l of locks) {
    if (!CHAINS[l.networkId]) continue
    m.set(l.networkId, [...(m.get(l.networkId) ?? []), l.address])
  }
  return m
}

/**
 * Scan these members' wallets (every EVM MemberWallet row plus any extra wallet given) and update
 * UnlockKey + UnlockScanState. Throws (after recording lastError) when the subgraph fails, having
 * changed no keys.
 */
export async function scanMembers(memberIds: string[], extraWallets: Array<{ memberId: string; wallet: string }> = []): Promise<ScanResult> {
  const ids = [...new Set(memberIds)]
  const members = new Set(ids)
  const now = new Date()
  await Promise.all(
    ids.map((memberId) =>
      prisma.unlockScanState.upsert({ where: { memberId }, create: { memberId, lastAttemptAt: now }, update: { lastAttemptAt: now } }),
    ),
  )
  try {
    const wallets = await prisma.memberWallet.findMany({
      where: { memberId: { in: ids }, chainType: 'evm' },
      select: { id: true, memberId: true, walletAddress: true },
    })
    const ownerMap = buildOwnerMap(wallets, extraWallets.filter((e) => members.has(e.memberId)))
    const locksByNet = await enabledLocksByNet()
    const found = await fetchFound(ownerMap, locksByNet) // throws before any write

    const scannedLocks = new Set<string>()
    for (const [net, addrs] of locksByNet) for (const a of addrs) scannedLocks.add(`${net}:${a}`)
    const existing = await prisma.unlockKey.findMany({
      where: { OR: [{ memberId: { in: ids } }, { owner: { in: [...ownerMap.keys()] } }] },
      select: { id: true, memberId: true, networkId: true, lockAddress: true, tokenId: true, owner: true, gone: true },
    })
    // A row held by a member outside this scan is left alone unless a scanned wallet now holds it.
    const plan = planKeys(existing, found, members, scannedLocks)

    const ops = []
    if (plan.create.length) ops.push(prisma.unlockKey.createMany({ data: plan.create, skipDuplicates: true }))
    if (plan.touchIds.length) {
      ops.push(prisma.unlockKey.updateMany({ where: { id: { in: plan.touchIds } }, data: { lastSeenAt: now, gone: false, goneAt: null } }))
    }
    for (const r of plan.reassign) ops.push(prisma.unlockKey.update({ where: { id: r.id }, data: { memberId: r.memberId } }))
    if (plan.goneIds.length) ops.push(prisma.unlockKey.updateMany({ where: { id: { in: plan.goneIds } }, data: { gone: true, goneAt: now } }))
    if (ops.length) await prisma.$transaction(ops)

    // Count what each member holds now (enabled locks only).
    const live = await prisma.unlockKey.findMany({ where: { memberId: { in: ids }, gone: false }, select: { memberId: true, networkId: true, lockAddress: true } })
    const counts = new Map<string, number>()
    for (const k of live) if (scannedLocks.has(`${k.networkId}:${k.lockAddress}`)) counts.set(k.memberId, (counts.get(k.memberId) ?? 0) + 1)
    await Promise.all(
      ids.map((memberId) =>
        prisma.unlockScanState.update({
          where: { memberId },
          data: { lastScanAt: now, lastError: null, ticketCount: counts.get(memberId) ?? 0 },
        }),
      ),
    )
    return { members: ids.length, wallets: ownerMap.size, found: found.length, created: plan.create.length, gone: plan.goneIds.length }
  } catch (e) {
    const msg = (e instanceof Error ? e.message : 'scan failed').slice(0, 300)
    await prisma.unlockScanState.updateMany({ where: { memberId: { in: ids } }, data: { lastError: msg } }).catch(() => undefined)
    throw e
  }
}

export interface CronScanResult {
  members: number
  batches: number
  failedBatches: number
  created: number
  gone: number
  errors: string[]
}

const CRON_BATCH = 40

/** Nightly: every member with an EVM wallet, plus members who hold keys but lost their wallets. */
export async function scanAllMembers(): Promise<CronScanResult> {
  const [w, k] = await Promise.all([
    prisma.memberWallet.findMany({ where: { chainType: 'evm' }, select: { memberId: true }, distinct: ['memberId'] }),
    prisma.unlockKey.findMany({ where: { gone: false }, select: { memberId: true }, distinct: ['memberId'] }),
  ])
  const ids = [...new Set([...w, ...k].map((r) => r.memberId))]
  const out: CronScanResult = { members: ids.length, batches: 0, failedBatches: 0, created: 0, gone: 0, errors: [] }
  for (let i = 0; i < ids.length; i += CRON_BATCH) {
    out.batches++
    try {
      const r = await scanMembers(ids.slice(i, i + CRON_BATCH))
      out.created += r.created
      out.gone += r.gone
    } catch (e) {
      out.failedBatches++
      out.errors.push(e instanceof Error ? e.message.slice(0, 200) : 'failed')
    }
  }
  return out
}

// ---- Freshness and rescan rate limit ----

interface StateTimes {
  lastScanAt: Date | null
  lastAttemptAt: Date | null
}

const MIN_RETRY_MS = 10 * 60_000

/** Cached data older than the interval (or never scanned), and not attempted in the last 10 minutes. */
export function isStale(state: StateTimes | null, intervalHours: number, now = new Date()): boolean {
  if (state?.lastAttemptAt && now.getTime() - state.lastAttemptAt.getTime() < MIN_RETRY_MS) return false
  if (!state?.lastScanAt) return true
  return now.getTime() - state.lastScanAt.getTime() >= intervalHours * 3_600_000
}

/** Owner "Rescan" allowance: seconds to wait, or 0 when allowed. */
export function rescanWaitSeconds(state: StateTimes | null, cooldownMinutes: number, now = new Date()): number {
  if (!state?.lastAttemptAt) return 0
  const left = state.lastAttemptAt.getTime() + cooldownMinutes * 60_000 - now.getTime()
  return left > 0 ? Math.ceil(left / 1000) : 0
}

export async function shouldRefreshOnView(memberId: string): Promise<boolean> {
  const state = await prisma.unlockScanState.findUnique({ where: { memberId } })
  if (!state) {
    const hasWallet = await prisma.memberWallet.count({ where: { memberId, chainType: 'evm' } })
    if (!hasWallet) return false
  }
  return isStale(state, await getSetting('tickets.scanIntervalHours'))
}

// ---- Read side ----

export interface TicketEvent {
  networkId: number
  lockAddress: string
  name: string
  year: number | null
  count: number
  url: string | null
}

export interface TicketSummary {
  totalTickets: number
  events: TicketEvent[]
  wallets: number
  lastScanAt: Date | null
}

/** Newest year first (unknown last), then name. */
export function sortEvents(events: TicketEvent[]): TicketEvent[] {
  return [...events].sort((a, b) => (b.year ?? -1) - (a.year ?? -1) || a.name.localeCompare(b.name))
}

export async function getTicketSummary(memberId: string): Promise<TicketSummary> {
  const [keys, state, wallets] = await Promise.all([
    prisma.unlockKey.findMany({ where: { memberId, gone: false }, select: { networkId: true, lockAddress: true, tokenId: true, owner: true } }),
    prisma.unlockScanState.findUnique({ where: { memberId } }),
    prisma.memberWallet.count({ where: { memberId, chainType: 'evm' } }),
  ])
  if (keys.length === 0) return { totalTickets: 0, events: [], wallets, lastScanAt: state?.lastScanAt ?? null }
  const locks = await prisma.unlockLock.findMany({
    where: { enabled: true, OR: [...new Set(keys.map((k) => `${k.networkId}:${k.lockAddress}`))].map((s) => ({ networkId: Number(s.split(':')[0]), address: s.split(':')[1] })) },
  })
  const byLock = new Map(locks.map((l) => [`${l.networkId}:${l.address}`, l]))
  const events = new Map<string, TicketEvent>()
  let total = 0
  for (const k of keys) {
    const id = `${k.networkId}:${k.lockAddress}`
    const lock = byLock.get(id)
    if (!lock) continue // lock disabled by an admin
    total++
    const e = events.get(id)
    if (e) e.count++
    else events.set(id, { networkId: k.networkId, lockAddress: k.lockAddress, name: lock.name, year: lock.year, count: 1, url: eventUrl(lock.eventSlug) })
  }
  return { totalTickets: total, events: sortEvents([...events.values()]), wallets, lastScanAt: state?.lastScanAt ?? null }
}
