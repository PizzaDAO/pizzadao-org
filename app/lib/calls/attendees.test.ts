// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/lib/db')
vi.mock('@/app/lib/pfp', () => ({ resolvePfpUrlsAsync: async (ids: string[]) => Object.fromEntries(ids.map((i) => [i, `/pfp/${i}.png`])) }))
vi.mock('./crew-alias', async (orig) => ({ ...(await orig<typeof import('./crew-alias')>()), loadCrewAliases: async () => new Map([['ops-old', 'ops']]) }))

import { prisma } from '@/app/lib/db'
import { loadCallAttendees } from './attendees'

const ANN = '111111111111111111'
const BOB = '222222222222222222'
const CAROL = '333333333333333333'
const text = { speakerN: (n: number) => `Speaker ${n}`, fallback: 'Speaker' }
const rec = { id: 'r1', crewId: 'ops-old', startedAt: new Date('2026-11-05T23:00:00Z'), source: 'DISCORD', speakers: [{ discordId: ANN, displayName: 'Ann' }] }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.callRecording.findUnique).mockResolvedValue({ redactedSpeakerIds: [CAROL] } as never)
  vi.mocked(prisma.callAttendance.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.callPresence.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.member.findMany).mockResolvedValue([{ id: 'm-ann', discordId: ANN, name: 'Ann Member' }] as never)
})

describe('loadCallAttendees', () => {
  it('prefers crew-day attendance (canonical crew incl. aliases), links members, hides redacted, one member query', async () => {
    vi.mocked(prisma.callAttendance.findMany).mockResolvedValue([
      { discordId: BOB, displayName: 'Bob' },
      { discordId: ANN, displayName: 'ann' },
      { discordId: CAROL, displayName: 'Carol' },
      { discordId: ANN, displayName: 'ann' },
      { discordId: 'bot', displayName: 'Bot' },
    ] as never)
    const out = await loadCallAttendees(rec, text)
    expect(out).toEqual([
      { name: 'Ann Member', memberId: 'm-ann', pfpUrl: '/pfp/m-ann.png' },
      { name: 'Bob', memberId: null, pfpUrl: null },
    ])
    expect(prisma.member.findMany).toHaveBeenCalledTimes(1)
    const where = vi.mocked(prisma.callAttendance.findMany).mock.calls[0][0]?.where as { crewId: { in: string[] } }
    expect(where.crewId.in.sort()).toEqual(['ops', 'ops-old'])
    expect(prisma.callPresence.findMany).not.toHaveBeenCalled()
  })

  it('falls back to presence, then speakers', async () => {
    vi.mocked(prisma.callPresence.findMany).mockResolvedValue([{ discordId: BOB, displayName: 'Bob' }] as never)
    expect((await loadCallAttendees(rec, text)).map((a) => a.name)).toEqual(['Bob'])
    vi.mocked(prisma.callPresence.findMany).mockResolvedValue([] as never)
    expect((await loadCallAttendees(rec, text)).map((a) => a.name)).toEqual(['Ann Member'])
  })

  it('imported calls: speaker names only, no links, no member lookup, redacted hidden', async () => {
    const imp = { ...rec, source: 'X_BROADCAST', speakers: [{ discordId: 'xs:1', displayName: null }, { discordId: 'xs:2', displayName: 'Dana' }, { discordId: CAROL, displayName: 'Carol' }] }
    expect(await loadCallAttendees(imp, text)).toEqual([
      { name: 'Speaker 1', memberId: null, pfpUrl: null },
      { name: 'Dana', memberId: null, pfpUrl: null },
    ])
    expect(prisma.member.findMany).not.toHaveBeenCalled()
  })

  it('returns nothing when the database fails', async () => {
    vi.mocked(prisma.callRecording.findUnique).mockRejectedValue(new Error('down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await loadCallAttendees(rec, text)).toEqual([])
  })
})
