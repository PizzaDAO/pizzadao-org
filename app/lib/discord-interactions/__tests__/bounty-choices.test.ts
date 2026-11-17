// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const findMany = vi.fn()
vi.mock('@/app/lib/db', () => ({ prisma: { bounty: { findMany: (...a: unknown[]) => findMany(...a) } } }))

import { bountyChoice, bountyPickChoices } from '../bounty-choices'

const ME = '100000000000000001'
beforeEach(() => findMany.mockReset().mockResolvedValue([{ id: 3, reward: 1500, description: 'Fix the\nthing' }]))

describe('bountyPickChoices', () => {
  it('claim: OPEN bounties not posted by me', async () => {
    const r = await bountyPickChoices('claim', ME, '')
    const arg = findMany.mock.calls[0][0]
    expect(arg.where).toEqual({ status: 'OPEN', createdBy: { not: ME } })
    expect(arg.take).toBe(25)
    expect(r).toEqual([{ name: '#3 · 1,500 $PEP · Fix the thing', value: 3 }])
  })

  it('giveup: my CLAIMED / SUBMITTED bounties', async () => {
    await bountyPickChoices('giveup', ME, '')
    expect(findMany.mock.calls[0][0].where).toEqual({ claimedBy: ME, status: { in: ['CLAIMED', 'SUBMITTED'] } })
  })

  it('a query matches the description, and the id when numeric (leading # ignored)', async () => {
    await bountyPickChoices('claim', ME, '#12')
    expect(findMany.mock.calls[0][0].where.OR).toEqual([{ description: { contains: '12', mode: 'insensitive' } }, { id: 12 }])
    await bountyPickChoices('giveup', ME, 'Fix')
    expect(findMany.mock.calls[1][0].where.OR).toEqual([{ description: { contains: 'fix', mode: 'insensitive' } }])
  })
})

describe('bountyChoice', () => {
  it('cuts to 100 code points without splitting an emoji', () => {
    const name = bountyChoice({ id: 1, reward: 1, description: '🍕'.repeat(200) }).name
    expect(Array.from(name)).toHaveLength(100)
    expect(name).not.toMatch(/[\ud800-\udbff]$/)
  })
})
