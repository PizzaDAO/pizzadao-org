// GET /api/session exposes canReviewMissions (wider than isAdmin) for the
// /missions review panel.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/session', () => ({ getSession: vi.fn(), getSessionCookieOptions: vi.fn(() => ({ httpOnly: true, secure: false, sameSite: 'lax', path: '/', maxAge: 100 })) }))
vi.mock('@/app/lib/discord', () => ({ getUserRoles: vi.fn() }))
vi.mock('@/app/lib/db', () => ({ prisma: { appSetting: { findMany: vi.fn(async () => []) } } }))
vi.mock('@/app/lib/sheets/member-repository', () => ({
  fetchMemberByDiscordId: vi.fn().mockResolvedValue(null),
  fetchMemberById: vi.fn().mockResolvedValue(null),
}))

import { GET } from './route'
import { getSession } from '@/app/lib/session'
import { getUserRoles } from '@/app/lib/discord'
import { ADMIN_ROLE_IDS } from '@/app/ui/constants'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getSession).mockResolvedValue({ discordId: 'd1', username: 'u' } as never)
})

const flags = async (roles: string[] | Error) => {
  if (roles instanceof Error) vi.mocked(getUserRoles).mockRejectedValue(roles)
  else vi.mocked(getUserRoles).mockResolvedValue(roles)
  const json = await (await GET()).json()
  return { isAdmin: json.isAdmin, canReviewMissions: json.canReviewMissions }
}

describe('GET /api/session hint cookie', () => {
  it('200 backfills hint 1 (not httpOnly); 401 sets hint 0', async () => {
    vi.mocked(getUserRoles).mockResolvedValue([])
    const ok = await GET()
    const okCookie = ok.headers.get('set-cookie') ?? ''
    expect(okCookie).toMatch(/pizzadao_auth=1/)
    expect(okCookie).not.toMatch(/httponly/i)

    vi.mocked(getSession).mockResolvedValue(null as never)
    const no = await GET()
    expect(no.status).toBe(401)
    expect(no.headers.get('set-cookie') ?? '').toMatch(/pizzadao_auth=0/)
  })
})

describe('GET /api/session reviewer flags', () => {
  it('admins can review', async () => {
    expect(await flags([ADMIN_ROLE_IDS[0]])).toEqual({ isAdmin: true, canReviewMissions: true })
  })

  it('Pizza Capo / Pepperoni Mafia / DPR can review without being admins', async () => {
    for (const role of ['839206162837798945', '823266914834841610', '812131585327235113']) {
      expect(await flags([role])).toEqual({ isAdmin: false, canReviewMissions: true })
    }
  })

  it('everyone else, and lookup errors, get false', async () => {
    expect(await flags(['1234567'])).toEqual({ isAdmin: false, canReviewMissions: false })
    expect(await flags(new Error('down'))).toEqual({ isAdmin: false, canReviewMissions: false })
  })
})

describe('GET /api/session canManageShop (the /add-money rule)', () => {
  const shop = async (roles: string[] | Error) => {
    if (roles instanceof Error) vi.mocked(getUserRoles).mockRejectedValue(roles)
    else vi.mocked(getUserRoles).mockResolvedValue(roles)
    return (await (await GET()).json()).canManageShop
  }

  it('admins and Pepperoni Mafia may manage the shop', async () => {
    expect(await shop([ADMIN_ROLE_IDS[0]])).toBe(true)
    expect(await shop(['823266914834841610'])).toBe(true)
  })

  it('Pizza Capo (a mission reviewer) and everyone else may not; errors fail closed', async () => {
    expect(await shop(['839206162837798945'])).toBe(false)
    expect(await shop(['1234567'])).toBe(false)
    expect(await shop(new Error('down'))).toBe(false)
  })
})
