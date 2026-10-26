// @vitest-environment node
// A NOMINATED subject keeps normal access but their own entry is invisible to them:
// not in the lists, 404 in the detail.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/db', () => ({
  prisma: {
    disavowRound: { findMany: vi.fn(async () => []) },
    disavowal: { findUnique: vi.fn(), count: vi.fn(async () => 0), findMany: vi.fn(async () => []) },
  },
}))
vi.mock('./store', () => ({
  settleRound: vi.fn(), recordView: vi.fn(), subjectDiscordIds: vi.fn(async () => []), isSubjectOf: vi.fn(),
}))
vi.mock('./match', () => ({
  identifierOr: (ids: unknown[]) => ids,
  viewerIdentifiers: vi.fn(async (d: string) => [{ kind: 'DISCORD_ID', value: d }, { kind: 'WALLET', value: '0xabc' }]),
}))

import { prisma } from '@/app/lib/db'
import { isSubjectOf, recordView, settleRound } from './store'
import { getDisavowDetail, listDisavowals } from './detail'

const m = (f: unknown) => f as ReturnType<typeof vi.fn>
const entry = (over: Record<string, unknown> = {}) => ({
  id: 'e1', status: 'NOMINATED', nominatorDiscordId: 'nom', displayName: 'X', reason: 'SCAM', statement: 's', evidenceUrls: [],
  subjectResponse: null, respondedAt: null, listedAt: null, reviewDueAt: null, redactedAt: null,
  identifiers: [{ kind: 'WALLET', value: '0xabc' }], rounds: [], events: [], ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  m(isSubjectOf).mockResolvedValue(false)
})

describe('getDisavowDetail', () => {
  it('the subject of an entry gets null (404) for it, even as DPR, and the view is not logged', async () => {
    m(prisma.disavowal.findUnique).mockResolvedValue(entry())
    m(isSubjectOf).mockResolvedValue(true)
    expect(await getDisavowDetail('e1', { discordId: 'me', isDPR: true })).toBeNull()
    expect(recordView).not.toHaveBeenCalled()
  })
  it('others see a LISTED entry; duplicate-nomination events are hidden from the history', async () => {
    m(prisma.disavowal.findUnique).mockResolvedValue(entry({
      status: 'LISTED',
      events: [
        { type: 'NOMINATED', data: null, createdAt: new Date() },
        { type: 'NOMINATED', data: { duplicate: true }, createdAt: new Date() },
        { type: 'VIEWED', data: null, createdAt: new Date() },
      ],
    }))
    const d = await getDisavowDetail('e1', { discordId: 'viewer', isDPR: false })
    expect(d).not.toBeNull()
    expect(d!.history).toHaveLength(1)
    expect(d).not.toHaveProperty('nominatorDiscordId')
  })
  it('non-DPR cannot see a NOMINATED entry, not even the nominator (they use My nominations)', async () => {
    m(prisma.disavowal.findUnique).mockResolvedValue(entry())
    expect(await getDisavowDetail('e1', { discordId: 'viewer', isDPR: false })).toBeNull()
    expect(await getDisavowDetail('e1', { discordId: 'nom', isDPR: false })).toBeNull()
    expect(await getDisavowDetail('e1', { discordId: 'dpr', isDPR: true })).not.toBeNull()
  })
  it('access is checked before anything is settled or logged', async () => {
    m(prisma.disavowal.findUnique).mockResolvedValue(entry())
    m(prisma.disavowRound.findMany).mockResolvedValue([{ id: 'r1' }])
    m(isSubjectOf).mockResolvedValue(true)
    await getDisavowDetail('e1', { discordId: 'me', isDPR: true })
    await getDisavowDetail('e1', { discordId: 'viewer', isDPR: false }) // hidden NOMINATED entry
    expect(settleRound).not.toHaveBeenCalled()
    expect(recordView).not.toHaveBeenCalled()
  })
})

describe('listDisavowals', () => {
  it('excludes every entry about the viewer (by any of their identifiers)', async () => {
    await listDisavowals('open', 1, true, 'me')
    const where = m(prisma.disavowal.findMany).mock.calls[0][0].where
    expect(where.status.in).toEqual(['NOMINATED'])
    expect(where.NOT.identifiers.some.OR).toEqual([
      { kind: 'DISCORD_ID', value: 'me' }, { kind: 'WALLET', value: '0xabc' },
    ])
  })
  it('non-DPR always get the LISTED tab', async () => {
    const r = await listDisavowals('open', 1, false, 'me')
    expect(r.tab).toBe('listed')
    expect(m(prisma.disavowal.findMany).mock.calls[0][0].where.status.in).toEqual(['LISTED'])
  })
})
