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
  /** Chains whose subgraph could not be read: their keys were left exactly as they were. */
  failedChains: number[]
}

export interface FetchedKeys {
  found: FoundKey[]
  failed: Map<number, string>
}

/**
 * Fetch each chain's keys. A chain that fails is reported in `failed` (and contributes nothing);
 * the others still succeed. Nothing is written here.
 */
export async function fetchFound(ownerMap: Map<string, string>, locksByNet: Map<number, string[]>): Promise<FetchedKeys> {
  const owners = [...ownerMap.keys()]
  const out: FetchedKeys = { found: [], failed: new Map() }
  if (owners.length === 0) return out
  for (const [networkId, locks] of locksByNet) {
    if (locks.length === 0) continue
    try {
      const keys = await fetchKeys(networkId, owners, locks)
      for (const k of keys) {
        if (k.cancelled) continue
        const owner = normAddress(k.owner)
        const memberId = ownerMap.get(owner)
        if (!memberId) continue
        out.found.push({ networkId, lockAddress: normAddress(k.lock.id), tokenId: String(k.tokenId), owner, memberId })
      }
    } catch (e) {
      out.failed.set(networkId, e instanceof Error ? e.message : 'failed')
    }
  }
  return out
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
 * UnlockKey + UnlockScanState.
 *
 * - Who owns an address is decided across ALL MemberWallet rows (lowest row id wins globally), so a
 *   wallet shared by two members is counted once, for the same member whoever triggers the scan.
 *   Every member whose count changes gets their ticketCount updated.
 * - Chains are all-or-nothing each: a failing chain adds no keys and marks none gone, its error is
 *   recorded, and the other chains still advance. If every chain fails this throws having written
 *   no keys, so an outage is never stored as "0 tickets".
 */
export async function scanMembers(memberIds: string[], extraWallets: Array<{ memberId: string; wallet: string }> = []): Promise<ScanResult> {
  const ids = [...new Set(memberIds)]
  const members = new Set(ids)
  const now = new Date()
  const extra = extraWallets.filter((e) => members.has(e.memberId))
  await Promise.all(
    ids.map((memberId) =>
      prisma.unlockScanState.upsert({ where: { memberId }, create: { memberId, lastAttemptAt: now }, update: { lastAttemptAt: now } }),
    ),
  )
  try {
    const own = await prisma.memberWallet.findMany({
      where: { memberId: { in: ids }, chainType: 'evm' },
      select: { walletAddress: true },
    })
    const addrs = [...new Set([...own.map((w) => normAddress(w.walletAddress)), ...extra.map((e) => normAddress(e.wallet))])].filter((a) => ADDRESS_RE.test(a))
    // Every row for those addresses (any member), to pick the global winner per address.
    const allRows = addrs.length
      ? await prisma.memberWallet.findMany({
          where: { chainType: 'evm', OR: addrs.map((a) => ({ walletAddress: { equals: a, mode: 'insensitive' as const } })) },
          select: { id: true, memberId: true, walletAddress: true },
        })
      : []
    const ownerMap = buildOwnerMap(allRows, extra)
    const locksByNet = await enabledLocksByNet()
    const { found, failed } = await fetchFound(ownerMap, locksByNet)
    const chainsWithLocks = [...locksByNet.values()].filter((l) => l.length > 0).length
    if (failed.size > 0 && failed.size === chainsWithLocks) {
      throw new Error([...failed].map(([n, m]) => `${CHAINS[n] ?? n}: ${m}`).join('; '))
    }

    const enabledLocks = new Set<string>()
    const scannedLocks = new Set<string>() // enabled locks on chains that were read successfully
    for (const [net, list] of locksByNet) {
      for (const a of list) {
        enabledLocks.add(`${net}:${a}`)
        if (!failed.has(net)) scannedLocks.add(`${net}:${a}`)
      }
    }
    const owners = [...ownerMap.keys()]
    const existing = await prisma.unlockKey.findMany({
      where: { OR: [{ memberId: { in: ids } }, ...(owners.length ? [{ owner: { in: owners } }] : [])] },
      select: { id: true, memberId: true, networkId: true, lockAddress: true, tokenId: true, owner: true, gone: true },
    })
    // Keys on a failed chain never reach `found`, and planKeys only marks gone on scanned chains.
    const plan = planKeys(existing, found, members, scannedLocks)

    const ops = []
    if (plan.create.length) ops.push(prisma.unlockKey.createMany({ data: plan.create, skipDuplicates: true }))
    if (plan.touchIds.length) {
      ops.push(prisma.unlockKey.updateMany({ where: { id: { in: plan.touchIds } }, data: { lastSeenAt: now, gone: false, goneAt: null } }))
    }
    for (const r of plan.reassign) ops.push(prisma.unlockKey.update({ where: { id: r.id }, data: { memberId: r.memberId } }))
    if (plan.goneIds.length) ops.push(prisma.unlockKey.updateMany({ where: { id: { in: plan.goneIds } }, data: { gone: true, goneAt: now } }))
    if (ops.length) await prisma.$transaction(ops)

    // Everyone whose keys may have changed: the scanned members, new owners, and previous holders.
    const affected = new Set<string>(ids)
    for (const f of plan.create) affected.add(f.memberId)
    const heldBy = new Map(existing.map((e) => [e.id, e.memberId]))
    for (const r of plan.reassign) {
      affected.add(r.memberId)
      const prev = heldBy.get(r.id)
      if (prev) affected.add(prev)
    }
    const affectedIds = [...affected]
    const live = await prisma.unlockKey.findMany({ where: { memberId: { in: affectedIds }, gone: false }, select: { memberId: true, networkId: true, lockAddress: true } })
    const counts = new Map<string, number>()
    for (const k of live) if (enabledLocks.has(`${k.networkId}:${k.lockAddress}`)) counts.set(k.memberId, (counts.get(k.memberId) ?? 0) + 1)
    const failedChains = [...failed.keys()]
    const errorText = failedChains.length ? failedChains.map((n) => `${CHAINS[n] ?? n}: ${failed.get(n)}`).join('; ').slice(0, 300) : null
    await Promise.all(
      affectedIds.map((memberId) =>
        members.has(memberId)
          ? prisma.unlockScanState.update({
              where: { memberId },
              data: { ...(failedChains.length ? {} : { lastScanAt: now }), lastError: errorText, ticketCount: counts.get(memberId) ?? 0 },
            })
          : prisma.unlockScanState.upsert({
              where: { memberId },
              create: { memberId, ticketCount: counts.get(memberId) ?? 0 },
              update: { ticketCount: counts.get(memberId) ?? 0 },
            }),
      ),
    )
    return { members: ids.length, wallets: ownerMap.size, found: found.length, created: plan.create.length, gone: plan.goneIds.length, failedChains }
  } catch (e) {
    const msg = (e instanceof Error ? e.message : 'scan failed').slice(0, 300)
    await prisma.unlockScanState.updateMany({ where: { memberId: { in: ids } }, data: { lastError: msg } }).catch(() => undefined)
    throw e
  }
}

export interface CronScanResult {
  members: number
  scanned: number
  batches: number
  failedBatches: number
  partialBatches: number
  created: number
  gone: number
  stoppedEarly: boolean
  errors: string[]
}

const CRON_BATCH = 40
export const CRON_BUDGET_MS = 250_000

/**
 * Nightly: every member with an EVM wallet, plus members who hold keys but lost their wallets.
 * Oldest lastScanAt first (never-scanned first), and it stops at ~250s, so a run cut short is
 * resumed by the next one from where the stalest members are.
 */
export async function scanAllMembers(budgetMs = CRON_BUDGET_MS, nowFn: () => number = Date.now): Promise<CronScanResult> {
  const start = nowFn()
  const [w, k] = await Promise.all([
    prisma.memberWallet.findMany({ where: { chainType: 'evm' }, select: { memberId: true }, distinct: ['memberId'] }),
    prisma.unlockKey.findMany({ where: { gone: false }, select: { memberId: true }, distinct: ['memberId'] }),
  ])
  const all = [...new Set([...w, ...k].map((r) => r.memberId))]
  const states = await prisma.unlockScanState.findMany({ where: { memberId: { in: all } }, select: { memberId: true, lastScanAt: true } })
  const last = new Map(states.map((s) => [s.memberId, s.lastScanAt ? s.lastScanAt.getTime() : -1]))
  const ids = all.sort((a, b) => (last.get(a) ?? -1) - (last.get(b) ?? -1))
  const out: CronScanResult = { members: ids.length, scanned: 0, batches: 0, failedBatches: 0, partialBatches: 0, created: 0, gone: 0, stoppedEarly: false, errors: [] }
  for (let i = 0; i < ids.length; i += CRON_BATCH) {
    if (nowFn() - start > budgetMs) {
      out.stoppedEarly = true
      break
    }
    const batch = ids.slice(i, i + CRON_BATCH)
    out.batches++
    try {
      const r = await scanMembers(batch)
      out.scanned += batch.length
      out.created += r.created
      out.gone += r.gone
      if (r.failedChains.length) {
        out.partialBatches++
        out.errors.push(`chains failed: ${r.failedChains.join(',')}`)
      }
    } catch (e) {
      out.failedBatches++
      out.errors.push(e instanceof Error ? e.message.slice(0, 200) : 'failed')
    }
  }
  console.log('[unlock-tickets] nightly scan', JSON.stringify(out))
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

/**
 * Atomically claim a background refresh for a profile view: true for exactly one caller when the
 * cache is stale and no attempt was made in the last 10 minutes (updateMany on lastAttemptAt).
 */
export async function claimRefreshOnView(memberId: string, now = new Date()): Promise<boolean> {
  const intervalHours = await getSetting('tickets.scanIntervalHours')
  const state = await prisma.unlockScanState.findUnique({ where: { memberId } })
  if (!state) {
    if (!(await prisma.memberWallet.count({ where: { memberId, chainType: 'evm' } }))) return false
    await prisma.unlockScanState.createMany({ data: [{ memberId }], skipDuplicates: true })
  }
  const retryCutoff = new Date(now.getTime() - MIN_RETRY_MS)
  const staleCutoff = new Date(now.getTime() - intervalHours * 3_600_000)
  const res = await prisma.unlockScanState.updateMany({
    where: {
      memberId,
      AND: [
        { OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lt: retryCutoff } }] },
        { OR: [{ lastScanAt: null }, { lastScanAt: { lt: staleCutoff } }] },
      ],
    },
    data: { lastAttemptAt: now },
  })
  return res.count === 1
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
