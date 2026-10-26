// @vitest-environment node
// Who may see the list: level 5+ or DPR, never anyone named on it, 404 for the rest.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND') } }))
vi.mock('@/app/lib/db', () => ({
  prisma: { disavowIdentifier: { findFirst: vi.fn() }, disavowal: { findUnique: vi.fn() } },
}))
vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/app/lib/missions', () => ({ getCurrentLevel: vi.fn() }))
vi.mock('@/app/lib/mission-review-access', () => ({ DPR_ONLY_MIN_LEVEL: 8, canReviewMission: vi.fn() }))
vi.mock('@/app/lib/disavow/match', () => ({
  identifierOr: (ids: Array<{ kind: string; value: string }>) => ids,
  viewerIdentifiers: vi.fn(async (d: string) => [
    { kind: 'DISCORD_ID', value: d }, { kind: 'MEMBER_ID', value: '77' },
    { kind: 'WALLET', value: '0xabc' }, { kind: 'X_HANDLE', value: 'me' },
  ]),
}))

import { prisma } from '@/app/lib/db'
import { getSession } from '@/app/lib/session'
import { getCurrentLevel } from '@/app/lib/missions'
import { canReviewMission } from '@/app/lib/mission-review-access'
import {
  canViewDisavowList, disavowViewer, requireDisavowDPR, requireDisavowViewer, requireDisavowViewerPage,
} from './access'

const m = (f: unknown) => f as ReturnType<typeof vi.fn>
const ME = '400000000000000001'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.DISAVOW_ENABLED = 'true'
  m(getSession).mockResolvedValue({ discordId: ME })
  m(getCurrentLevel).mockResolvedValue(1)
  m(canReviewMission).mockResolvedValue(false)
  m(prisma.disavowIdentifier.findFirst).mockResolvedValue(null)
})
afterEach(() => { delete process.env.DISAVOW_ENABLED })

describe('canViewDisavowList', () => {
  it('level 4 is denied, level 5 allowed', async () => {
    m(getCurrentLevel).mockResolvedValue(4)
    expect(await canViewDisavowList(ME)).toBe(false)
    m(getCurrentLevel).mockResolvedValue(5)
    expect(await canViewDisavowList(ME)).toBe(true)
  })
  it('DPR at level 1 is allowed, and flagged DPR', async () => {
    m(canReviewMission).mockResolvedValue(true)
    expect(await disavowViewer(ME)).toEqual({ allowed: true, isDPR: true })
    expect(canReviewMission).toHaveBeenCalledWith(ME, 8)
  })
  it('a listed/nominated person is denied whatever their level, even DPR', async () => {
    m(getCurrentLevel).mockResolvedValue(8)
    m(canReviewMission).mockResolvedValue(true)
    m(prisma.disavowIdentifier.findFirst).mockResolvedValue({ id: 1 })
    expect(await canViewDisavowList(ME)).toBe(false)
  })
  it('subject lookup matches Discord id, member id, wallets and X handle, only for LISTED/SUSPENDED', async () => {
    await canViewDisavowList(ME)
    const where = m(prisma.disavowIdentifier.findFirst).mock.calls[0][0].where
    expect(where.OR).toEqual([
      { kind: 'DISCORD_ID', value: ME },
      { kind: 'MEMBER_ID', value: '77' },
      { kind: 'WALLET', value: '0xabc' },
      { kind: 'X_HANDLE', value: 'me' },
    ])
    expect(where.disavowal.status.in).toEqual(['LISTED', 'SUSPENDED'])
  })
  it('a merely NOMINATED person keeps access and the same canViewDisavow (no tell)', async () => {
    m(getCurrentLevel).mockResolvedValue(6)
    const before = await disavowViewer(ME)
    // the only entry about them is NOMINATED: the LISTED/SUSPENDED query finds nothing
    m(prisma.disavowIdentifier.findFirst).mockImplementation(async ({ where }: { where: { disavowal: { status: { in: string[] } } } }) =>
      where.disavowal.status.in.includes('NOMINATED') ? { id: 1 } : null)
    expect(await disavowViewer(ME)).toEqual(before)
    expect(before.allowed).toBe(true)
  })
  it('a LISTED or SUSPENDED person is locked out', async () => {
    m(getCurrentLevel).mockResolvedValue(6)
    for (const status of ['LISTED', 'SUSPENDED']) {
      m(prisma.disavowIdentifier.findFirst).mockImplementation(async ({ where }: { where: { disavowal: { status: { in: string[] } } } }) =>
        where.disavowal.status.in.includes(status) ? { id: 1 } : null)
      expect((await disavowViewer(ME)).allowed).toBe(false)
    }
  })
  it('fails closed on lookup errors', async () => {
    m(prisma.disavowIdentifier.findFirst).mockRejectedValue(new Error('db down'))
    m(getCurrentLevel).mockResolvedValue(8)
    expect(await canViewDisavowList(ME)).toBe(false)
    m(prisma.disavowIdentifier.findFirst).mockResolvedValue(null)
    m(getCurrentLevel).mockRejectedValue(new Error('x'))
    m(canReviewMission).mockResolvedValue(false)
    expect(await canViewDisavowList(ME)).toBe(false)
  })
  it('a Discord lookup error means DPR-only actions are denied', async () => {
    m(canReviewMission).mockRejectedValue(new Error('discord'))
    const g = await requireDisavowDPR()
    expect(g.ok).toBe(false)
  })
  it('is off entirely without the flag', async () => {
    delete process.env.DISAVOW_ENABLED
    m(canReviewMission).mockResolvedValue(true)
    expect(await canViewDisavowList(ME)).toBe(false)
    expect((await requireDisavowViewer()).ok).toBe(false)
  })
})

describe('guards', () => {
  it('no session, ineligible and flag-off all give the same 404 with no-store', async () => {
    m(getSession).mockResolvedValue(null)
    const a = await requireDisavowViewer()
    m(getSession).mockResolvedValue({ discordId: ME })
    const b = await requireDisavowViewer()
    for (const g of [a, b]) {
      expect(g.ok).toBe(false)
      if (!g.ok) {
        expect(g.response.status).toBe(404)
        expect(g.response.headers.get('Cache-Control')).toBe('private, no-store')
        expect(await g.response.json()).toEqual({ error: 'Not found' })
      }
    }
  })
  it('non-DPR viewer is 404 on DPR-only guard', async () => {
    m(getCurrentLevel).mockResolvedValue(6)
    expect((await requireDisavowViewer()).ok).toBe(true)
    const g = await requireDisavowDPR()
    expect(g.ok).toBe(false)
    if (!g.ok) expect(g.response.status).toBe(404)
  })
  it('page guard throws notFound for ineligible users', async () => {
    await expect(requireDisavowViewerPage()).rejects.toThrow('NEXT_NOT_FOUND')
    m(getCurrentLevel).mockResolvedValue(5)
    await expect(requireDisavowViewerPage()).resolves.toMatchObject({ isDPR: false })
  })
})
