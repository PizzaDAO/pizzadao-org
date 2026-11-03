// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/db')
vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/app/lib/missions', () => ({ getCurrentLevel: vi.fn() }))
vi.mock('@/app/lib/mission-review-access', () => ({ isDreadPizzaRoberts: vi.fn() }))
vi.mock('@/app/lib/settings', () => ({ getSetting: vi.fn() }))
vi.mock('@/app/lib/sheets/members-list', () => ({ fetchAllMembers: vi.fn(async () => []) }))
vi.mock('./replies-view', () => ({ listReplies: vi.fn(async () => [{ id: 'f1', ownerName: 'A', crew: 'C', callTitle: null, channel: 'DISCORD', reply: 'hello there', repliedAt: '2026-11-02T10:00:00.000Z' }]) }))

import { getSession } from '@/app/lib/session'
import { getCurrentLevel } from '@/app/lib/missions'
import { isDreadPizzaRoberts } from '@/app/lib/mission-review-access'
import { getSetting } from '@/app/lib/settings'
import { GET } from '@/app/api/followups/replies/route'
import * as repliesRoute from '@/app/api/followups/replies/route'
import * as adminList from '@/app/api/admin/followups/route'
import * as adminOne from '@/app/api/admin/followups/[id]/route'

const as = (level: number, dpr = false) => {
  vi.mocked(getSession).mockResolvedValue({ discordId: 'u1' } as never)
  vi.mocked(getCurrentLevel).mockResolvedValue(level)
  vi.mocked(isDreadPizzaRoberts).mockResolvedValue(dpr)
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getSetting).mockResolvedValue(7 as never)
})

describe('GET /api/followups/replies', () => {
  it('allows level 7 and returns the reply text', async () => {
    as(7)
    const res = await GET()
    expect(res.status).toBe(200)
    expect((await res.json()).items[0].reply).toBe('hello there')
  })
  it('denies level 6', async () => {
    as(6)
    const res = await GET()
    expect(res.status).toBe(403)
    expect(JSON.stringify(await res.json())).not.toContain('hello')
  })
  it('allows Dread Pizza Roberts at a low level', async () => {
    as(1, true)
    expect((await GET()).status).toBe(200)
  })
  it('401 without a session', async () => {
    vi.mocked(getSession).mockResolvedValue(null as never)
    expect((await GET()).status).toBe(401)
  })
  it('has no write methods', () => {
    for (const m of ['POST', 'PATCH', 'PUT', 'DELETE']) expect((repliesRoute as Record<string, unknown>)[m]).toBeUndefined()
  })
})

describe('admin followups routes stay Dread Pizza Roberts only', () => {
  it('refuses a level 7 member on the admin list and every write', async () => {
    as(7)
    expect((await adminList.GET(new Request('http://x/api/admin/followups'))).status).toBe(403)
    const ctx = { params: Promise.resolve({ id: 'f1' }) }
    const init = (method: string) => new Request('http://x/api/admin/followups/f1', { method, body: JSON.stringify({ action: 'dismiss', message: 'x' }) })
    expect((await adminOne.POST(init('POST'), ctx)).status).toBe(403)
    expect((await adminOne.PATCH(init('PATCH'), ctx)).status).toBe(403)
  })
})
