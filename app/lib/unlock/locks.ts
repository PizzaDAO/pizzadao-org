/**
 * The Unlock lock list (UnlockLock table): which contracts count as a Pizza Party Ticket.
 * Seeded from data/gpp-contracts.json, grown by discovery (any pizza-named lock on a supported
 * chain), and curated at /admin/tickets. A "Pizza Party Ticket" is a key on any ENABLED lock.
 */
import { prisma } from '@/app/lib/db'
import { getSetting } from '@/app/lib/settings'
import seed from '@/data/gpp-contracts.json'
import { CHAINS, fetchLock, fetchLocksByTerms, type SubgraphLock } from './subgraph'

export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
export const DEFAULT_TERMS = ['pizza', 'pizzadao', 'pizza party', 'bitcoin pizza day']

export const normAddress = (a: string) => a.trim().toLowerCase()

/** Terms from the tickets.discoveryTerms setting: one per line, trimmed, lowercase, deduped. */
export function parseTerms(raw: string): string[] {
  const out = new Set<string>()
  for (const line of raw.split('\n')) {
    const t = line.trim().toLowerCase()
    if (t) out.add(t)
  }
  return [...out]
}

/** Case-insensitive "name contains any term". */
export function matchesTerms(name: string, terms: string[]): boolean {
  const n = name.toLowerCase()
  return terms.some((t) => t && n.includes(t.toLowerCase()))
}

/** A year for a lock: a 20xx in its name, else the year of its last key mint, else null. */
export function guessYear(name: string, lastKeyMintedAt?: string | null): number | null {
  const m = /\b(20[12]\d)\b/.exec(name)
  if (m) return Number(m[1])
  const ts = Number(lastKeyMintedAt)
  if (Number.isFinite(ts) && ts > 0) return new Date(ts * 1000).getUTCFullYear()
  return null
}

export interface SeedRow {
  address: string
  network_id: number
  event_name: string
  event_slug?: string
  event_start_date?: string
}

/** gpp-contracts.json rows as UnlockLock create data. */
export function seedRows(rows: SeedRow[] = seed as SeedRow[]) {
  return rows
    .filter((r) => ADDRESS_RE.test(r.address) && CHAINS[r.network_id])
    .map((r) => ({
      networkId: r.network_id,
      address: normAddress(r.address),
      name: r.event_name.trim().slice(0, 200) || 'Global Pizza Party',
      year: r.event_start_date ? Number(r.event_start_date.slice(0, 4)) || null : null,
      eventSlug: r.event_slug ? r.event_slug.slice(0, 200) : null,
      enabled: true,
      source: 'seed',
    }))
}

/** Insert any missing seed locks. Existing rows (and admin edits) are never touched. */
export async function seedLocks(): Promise<number> {
  const res = await prisma.unlockLock.createMany({ data: seedRows(), skipDuplicates: true })
  return res.count
}

export interface DiscoveryChainResult {
  networkId: number
  chain: string
  found: number
  added: number
  error?: string
}

/** New lock rows for discovered locks (pure, so it is testable). */
export function discoveredRows(networkId: number, locks: SubgraphLock[], terms: string[]) {
  const seen = new Set<string>()
  const out = []
  for (const l of locks) {
    const address = normAddress(l.address)
    if (!ADDRESS_RE.test(address) || seen.has(address) || !matchesTerms(l.name ?? '', terms)) continue
    seen.add(address)
    out.push({
      networkId,
      address,
      name: (l.name || 'Pizza event').trim().slice(0, 200),
      year: guessYear(l.name ?? '', l.lastKeyMintedAt),
      enabled: true,
      source: 'discovered',
    })
  }
  return out
}

/**
 * Query every chain's subgraph for locks whose name matches the terms and add the new ones,
 * enabled, source 'discovered'. Existing rows are never changed (an admin-disabled lock stays
 * disabled). One chain failing is reported and does not stop the others. `dryRun` writes nothing.
 */
export async function discoverLocks(opts: { terms?: string[]; dryRun?: boolean; chains?: number[] } = {}): Promise<DiscoveryChainResult[]> {
  const terms = opts.terms ?? parseTerms(await getSetting('tickets.discoveryTerms'))
  const results: DiscoveryChainResult[] = []
  for (const id of opts.chains ?? Object.keys(CHAINS).map(Number)) {
    const r: DiscoveryChainResult = { networkId: id, chain: CHAINS[id], found: 0, added: 0 }
    try {
      const rows = discoveredRows(id, await fetchLocksByTerms(id, terms), terms)
      r.found = rows.length
      if (opts.dryRun) {
        const have = await prisma.unlockLock.findMany({ where: { networkId: id, address: { in: rows.map((x) => x.address) } }, select: { address: true } })
        r.added = rows.length - have.length
      } else if (rows.length) {
        r.added = (await prisma.unlockLock.createMany({ data: rows, skipDuplicates: true })).count
      }
    } catch (e) {
      r.error = e instanceof Error ? e.message.slice(0, 200) : 'failed'
    }
    results.push(r)
  }
  return results
}

/** Add (or update) a lock by hand. The name comes from the subgraph when not given. */
export async function addLockByAddress(input: { networkId: number; address: string; name?: string; year?: number | null }) {
  if (!CHAINS[input.networkId]) throw new Error('Unsupported chain')
  if (!ADDRESS_RE.test(input.address)) throw new Error('Not a valid address')
  const address = normAddress(input.address)
  let name = input.name?.trim()
  let year = input.year ?? null
  if (!name || year == null) {
    const found = await fetchLock(input.networkId, address)
    if (!name && !found) throw new Error('That lock was not found on this chain; give it a name to add it anyway')
    name = name || found?.name || 'Pizza event'
    if (year == null) year = guessYear(name, found?.lastKeyMintedAt)
  }
  return prisma.unlockLock.upsert({
    where: { networkId_address: { networkId: input.networkId, address } },
    create: { networkId: input.networkId, address, name: name.slice(0, 200), year, enabled: true, source: 'admin' },
    update: { name: name.slice(0, 200), year, enabled: true },
  })
}

/** Unlock event page for a lock's slug; null when the slug is unknown. */
export function eventUrl(slug: string | null | undefined): string | null {
  return slug ? `https://app.unlock-protocol.com/event/${encodeURIComponent(slug)}` : null
}
