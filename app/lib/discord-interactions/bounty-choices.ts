/**
 * Autocomplete choices for /bounty claim and /bounty giveup: one capped, select-limited query, cheap
 * enough for Discord's 3-second autocomplete window.
 */
import { prisma } from '@/app/lib/db'

/** `#id · N $PEP · description`, at most 100 characters (Discord's limit for a choice name), cut by code points. */
export const bountyChoice = (b: { id: number; reward: number; description: string }) => ({
  name: Array.from(`#${b.id} · ${b.reward.toLocaleString('en-US')} $PEP · ${b.description.replace(/\s+/g, ' ').trim()}`).slice(0, 100).join(''),
  value: b.id,
})

/** claim: open bounties that aren't yours. giveup: your own CLAIMED / SUBMITTED bounties. */
export async function bountyPickChoices(kind: 'claim' | 'giveup', discordId: string, query: string): Promise<Array<{ name: string; value: number }>> {
  const q = query.trim().toLowerCase().replace(/^#/, '')
  const textMatch = q ? [{ description: { contains: q, mode: 'insensitive' as const } }, ...(/^\d{1,9}$/.test(q) ? [{ id: Number(q) }] : [])] : undefined
  const rows = await prisma.bounty.findMany({
    where:
      kind === 'claim'
        ? { status: 'OPEN', createdBy: { not: discordId }, ...(textMatch ? { OR: textMatch } : {}) }
        : { claimedBy: discordId, status: { in: ['CLAIMED', 'SUBMITTED'] }, ...(textMatch ? { OR: textMatch } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 25,
    select: { id: true, reward: true, description: true },
  })
  return rows.map(bountyChoice)
}
