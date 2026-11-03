// @vitest-environment node
// GET /api/vouches/quick and /api/vouches/vouchers: both answer "off" until their setting is on.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { toggle, findMany, getSession, getVouchers } = vi.hoisted(() => ({
  toggle: vi.fn(),
  findMany: vi.fn(),
  getSession: vi.fn(),
  getVouchers: vi.fn(),
}))
vi.mock('@/app/lib/settings/toggles', () => ({ toggleEnabled: toggle }))
vi.mock('@/app/lib/db', () => ({ prisma: { vouch: { findMany } } }))
vi.mock('@/app/lib/session', () => ({ getSession }))
vi.mock('@/app/lib/member-utils', () => ({ findMemberByDiscordId: vi.fn(async () => ({ memberId: '42', name: 'Me' })) }))
vi.mock('@/app/lib/vouches', () => ({
  getVouchers,
  getVouchCounts: vi.fn(async () => ({ pizzadaoFollowers: 3, followers: 5, total: 2 })),
}))

import { GET as quick } from './quick/route'
import { GET as vouchers } from './vouchers/route'

beforeEach(() => {
  vi.clearAllMocks()
  getSession.mockResolvedValue({ discordId: 'd1' })
  findMany.mockResolvedValue([{ followeeId: '7' }, { followeeId: '8' }])
  getVouchers.mockResolvedValue([{ memberId: '1', name: 'Ada', city: 'Rome', crews: 'x', source: 'PIZZADAO', createdAt: new Date() }])
})

describe('GET /api/vouches/quick', () => {
  it('off by setting: disabled, and nothing is read', async () => {
    toggle.mockResolvedValue(false)
    expect(await (await quick()).json()).toEqual({ enabled: false, vouchedIds: [] })
    expect(findMany).not.toHaveBeenCalled()
  })
  it('signed out: disabled', async () => {
    toggle.mockResolvedValue(true)
    getSession.mockResolvedValue(null)
    expect(await (await quick()).json()).toEqual({ enabled: false, vouchedIds: [] })
  })
  it('on and signed in: the members the viewer already vouched for', async () => {
    toggle.mockResolvedValue(true)
    const res = await quick()
    expect(await res.json()).toEqual({ enabled: true, memberId: '42', vouchedIds: ['7', '8'] })
    expect(res.headers.get('cache-control')).toContain('no-store')
    expect(toggle).toHaveBeenCalledWith('vouches.quickVouchEnabled')
  })
})

describe('GET /api/vouches/vouchers', () => {
  const req = (q: string) => ({ nextUrl: new URL(`https://x/api/vouches/vouchers${q}`) }) as never
  it('validates the member id', async () => {
    expect((await vouchers(req(''))).status).toBe(400)
    expect((await vouchers(req('?memberId=abc'))).status).toBe(400)
  })
  it('off by setting: only { enabled: false }', async () => {
    toggle.mockResolvedValue(false)
    expect(await (await vouchers(req('?memberId=7'))).json()).toEqual({ enabled: false })
    expect(getVouchers).not.toHaveBeenCalled()
  })
  it('on: the PizzaDAO vouchers and their count', async () => {
    toggle.mockResolvedValue(true)
    const body = await (await vouchers(req('?memberId=7'))).json()
    expect(body).toEqual({ enabled: true, total: 3, vouchers: [{ memberId: '1', name: 'Ada', city: 'Rome' }] })
    expect(getVouchers).toHaveBeenCalledWith('7', 24, 'PIZZADAO')
    expect(toggle).toHaveBeenCalledWith('vouches.showVouchersEnabled')
  })
})
