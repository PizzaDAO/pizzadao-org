import { describe, it, expect, vi } from 'vitest'

vi.mock('@/app/lib/economy', () => ({
  getLeaderboard: vi.fn(async () => [
    { userId: '100000000000000001', balance: 300 },
    { userId: '100000000000000002', balance: 200 },
    { userId: '100000000000000003', balance: 100 },
  ]),
  formatCurrency: (n: number) => `${n} $PEP`,
}))
vi.mock('@/app/lib/sheets/member-repository', () => ({
  getSheetData: vi.fn(async () => ({ discordToMember: new Map([['100000000000000001', '42']]) })),
}))
vi.mock('@/app/lib/member-names', () => ({
  memberNamesByDiscordId: vi.fn(async () => new Map([['100000000000000001', { name: 'Member One', memberId: 'm-1' }]])),
}))
vi.mock('@/app/lib/discord-channels', () => ({
  getGuildMemberCleanName: vi.fn(async (id: string) => (id === '100000000000000002' ? 'Guild Two' : null)),
}))

import { GET } from './route'

describe('GET /api/economy/leaderboard names', () => {
  it('returns a server-resolved name per row and never a truncated id', async () => {
    const body = await (await GET()).json()
    expect(body.leaderboard.map((r: { name: string }) => r.name)).toEqual(['Member One', 'Guild Two', 'a member'])
    expect(body.leaderboard[0].memberId).toBe('42')
  })
})
