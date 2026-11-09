/**
 * Unlock Protocol subgraph client. One endpoint per chain: https://subgraph.unlock-protocol.com/<chainId>
 * (it rejects requests without a User-Agent). Every failure THROWS: a scan that cannot read the
 * subgraph must never look like "this member has no tickets", so callers persist nothing on error.
 */
const MAX_RETRIES = 3
const PAGE_SIZE = 1000
/** Owners and locks per query (keeps the request body and the `_in` lists small). */
export const OWNER_CHUNK = 50
export const LOCK_CHUNK = 200

export const CHAINS: Record<number, string> = {
  1: 'Ethereum',
  10: 'Optimism',
  56: 'BSC',
  100: 'Gnosis',
  137: 'Polygon',
  8453: 'Base',
  42161: 'Arbitrum',
}

export const SUBGRAPH_BASE = 'https://subgraph.unlock-protocol.com'
export const SUBGRAPHS: Record<number, string> = Object.fromEntries(
  Object.keys(CHAINS).map((id) => [Number(id), `${SUBGRAPH_BASE}/${id}`]),
)

export interface SubgraphKey {
  id: string
  owner: string
  tokenId: string
  expiration: string
  cancelled: boolean
  lock: { id: string }
}

export interface SubgraphLock {
  address: string
  name: string
  lastKeyMintedAt: string | null
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function querySubgraph(url: string, query: string, retries = MAX_RETRIES): Promise<Record<string, unknown>> {
  let lastErr: unknown
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'PizzaDAO-Unlock-Scan/2.0' },
        body: JSON.stringify({ query }),
      })
      if (res.status === 429) {
        lastErr = new Error('HTTP 429 from the Unlock subgraph')
        await sleep(3000 * (i + 1))
        continue
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
      const parsed = (await res.json()) as { data?: Record<string, unknown>; errors?: unknown }
      if (parsed.errors) throw new Error(`Subgraph error: ${JSON.stringify(parsed.errors).slice(0, 300)}`)
      if (!parsed.data) throw new Error('Subgraph returned no data')
      return parsed.data
    } catch (e) {
      lastErr = e
      if (i < retries - 1) await sleep(2000 * (i + 1))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('querySubgraph: exhausted retries')
}

const list = (xs: string[]) => `[${xs.map((x) => JSON.stringify(x.toLowerCase())).join(',')}]`

/** keys query for a batch of owners and locks, paged by id (id_gt cursor, ascending). */
export function buildKeysQuery(owners: string[], locks: string[], afterId: string, first = PAGE_SIZE): string {
  return `{
    keys(first: ${first}, orderBy: id, orderDirection: asc, where: { owner_in: ${list(owners)}, lock_in: ${list(locks)}, id_gt: ${JSON.stringify(afterId)} }) {
      id owner tokenId expiration cancelled lock { id }
    }
  }`
}

/** Locks whose name contains any term (case-insensitive), paged by id. */
export function buildLocksQuery(terms: string[], afterId: string, first = PAGE_SIZE): string {
  // The subgraph refuses a column filter beside `or`, so the cursor goes inside every branch.
  const ors = terms.map((t) => `{ id_gt: ${JSON.stringify(afterId)}, name_contains_nocase: ${JSON.stringify(t)} }`).join(', ')
  return `{
    locks(first: ${first}, orderBy: id, orderDirection: asc, where: { or: [${ors}] }) {
      address name lastKeyMintedAt
    }
  }`
}

const chunk = <T,>(xs: T[], n: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

export function subgraphUrl(networkId: number): string {
  const url = SUBGRAPHS[networkId]
  if (!url) throw new Error(`No Unlock subgraph for chain ${networkId}`)
  return url
}

/** Every key held by any of `owners` on any of `locks` (one chain). Throws on any failure. */
export async function fetchKeys(networkId: number, owners: string[], locks: string[]): Promise<SubgraphKey[]> {
  const url = subgraphUrl(networkId)
  const out: SubgraphKey[] = []
  for (const o of chunk(owners, OWNER_CHUNK)) {
    for (const l of chunk(locks, LOCK_CHUNK)) {
      let after = ''
      for (;;) {
        const data = await querySubgraph(url, buildKeysQuery(o, l, after))
        const page = (data.keys ?? []) as SubgraphKey[]
        out.push(...page)
        if (page.length < PAGE_SIZE) break
        after = page[page.length - 1].id
      }
    }
  }
  return out
}

/** Locks on one chain whose name matches any term. Throws on any failure. */
export async function fetchLocksByTerms(networkId: number, terms: string[]): Promise<SubgraphLock[]> {
  if (terms.length === 0) return []
  const url = subgraphUrl(networkId)
  const out: SubgraphLock[] = []
  let after = ''
  for (;;) {
    const data = await querySubgraph(url, buildLocksQuery(terms, after))
    const page = (data.locks ?? []) as SubgraphLock[]
    out.push(...page)
    if (page.length < PAGE_SIZE) break
    after = page[page.length - 1].address.toLowerCase()
  }
  return out
}

/** One lock by address, or null when the subgraph does not know it. */
export async function fetchLock(networkId: number, address: string): Promise<SubgraphLock | null> {
  const data = await querySubgraph(
    subgraphUrl(networkId),
    `{ locks(first: 1, where: { id: ${JSON.stringify(address.toLowerCase())} }) { address name lastKeyMintedAt } }`,
  )
  const locks = (data.locks ?? []) as SubgraphLock[]
  return locks[0] ?? null
}
