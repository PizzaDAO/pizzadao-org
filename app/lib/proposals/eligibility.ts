/**
 * Who may vote: members whose linked wallets hold a Rare Pizzas Box NFT (the same check as the L5.3 mission,
 * checkRarePizzaBox). The set is taken ONCE, when a proposal opens; a box moved to another wallet or member
 * afterwards cannot add a vote. One vote per member however many boxes. A failed lookup excludes the member
 * (fail closed) and is counted so the open event shows it.
 */
import { prisma } from '@/app/lib/db'
import { checkRarePizzaBox, type Lookup } from '@/app/lib/rare-pizza-box'
import { fetchMemberById } from '@/app/lib/sheets/member-repository'

export interface Candidate {
  memberId: string
  /** From the wallet row when known; otherwise resolved through `resolveDiscordId`. */
  discordId: string | null
}

export interface SnapshotDeps {
  candidates(): Promise<Candidate[]>
  resolveDiscordId(memberId: string): Promise<string | null>
  holdsBox(memberId: string): Promise<Lookup>
  concurrency?: number
}

export interface Snapshot {
  discordIds: string[]
  /** Members whose lookup failed (excluded). */
  errors: number
}

export async function snapshotEligibleVoters(deps: SnapshotDeps): Promise<Snapshot> {
  const all = await deps.candidates()
  // One entry per member.
  const byMember = new Map<string, Candidate>()
  for (const c of all) {
    const prev = byMember.get(c.memberId)
    if (!prev || (!prev.discordId && c.discordId)) byMember.set(c.memberId, c)
  }
  const list = [...byMember.values()]
  const found = new Set<string>()
  let errors = 0
  let next = 0
  const worker = async () => {
    for (;;) {
      const i = next++
      if (i >= list.length) return
      const c = list[i]
      const answer = await deps.holdsBox(c.memberId).catch((): Lookup => 'error')
      if (answer === 'error') { errors++; continue }
      if (answer !== 'yes') continue
      const id = c.discordId || (await deps.resolveDiscordId(c.memberId).catch(() => null))
      if (id) found.add(id)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, deps.concurrency ?? 8) }, worker))
  return { discordIds: [...found].sort(), errors }
}

export const defaultSnapshotDeps: SnapshotDeps = {
  async candidates() {
    const rows = await prisma.memberWallet.findMany({
      where: { chainType: 'evm' },
      select: { memberId: true, discordId: true },
    })
    return rows.map((r: { memberId: string; discordId: string | null }) => ({ memberId: r.memberId, discordId: r.discordId }))
  },
  async resolveDiscordId(memberId) {
    const row = await fetchMemberById(memberId)
    const id = typeof row?.discordId === 'string' ? row.discordId.trim() : ''
    return /^\d{5,25}$/.test(id) ? id : null
  },
  // No cache: an eligibility snapshot must reflect the chain now, not an hour-old answer.
  holdsBox: (memberId) => checkRarePizzaBox(memberId, { cache: false }),
  concurrency: 8,
}
