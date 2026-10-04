// @vitest-environment node
// Who may manage the shop: the /add-money rule (admin roles + Pepperoni
// Mafia). Checked by the lib guard, every /api/admin/shop route and the page.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./session', () => ({ getSession: vi.fn() }))
vi.mock('./discord', () => ({ getUserRoles: vi.fn() }))
vi.mock('./discord-interactions/guild-roles', () => ({ getGuildRoles: vi.fn().mockResolvedValue(null) }))
vi.mock('./db', () => ({ prisma: {} }))
vi.mock('./shop-admin', async (orig) => ({
  ...(await orig<typeof import('./shop-admin')>()),
  createShopItem: vi.fn().mockResolvedValue({ id: 1, name: 'X' }),
  getShopAdminOverview: vi.fn().mockResolvedValue({ items: [], events: [] }),
  adjustShopItemStock: vi.fn(),
  adminGrantItem: vi.fn(),
  adminRemoveItem: vi.fn(),
  deleteShopItem: vi.fn(),
}))
vi.mock('./pep-recipient', () => ({ resolvePepRecipient: vi.fn().mockResolvedValue('812345678901234567') }))
vi.mock('./shop-admin-people', () => ({ labelPeople: vi.fn().mockResolvedValue({}), eventPeople: () => [] }))

import { canManageShop, requireShopAdmin } from './shop-admin-auth'
import { getSession } from './session'
import { getUserRoles } from './discord'
import { createShopItem, adminGrantItem, deleteShopItem, getShopAdminOverview } from './shop-admin'
import { ADMIN_ROLE_IDS } from '@/app/ui/constants'
import { POST as createRoute } from '@/app/api/admin/shop/items/route'
import { DELETE as deleteRoute } from '@/app/api/admin/shop/items/[id]/route'
import { POST as grantRoute } from '@/app/api/admin/shop/grants/route'
import { GET as overviewRoute } from '@/app/api/admin/shop/route'

const PEPPERONI_MAFIA = '823266914834841610'
const ADMIN = ADMIN_ROLE_IDS[0]
const ME = '811111111111111111'

const as = (roles: string[] | Error | null) => {
  if (roles === null) {
    vi.mocked(getSession).mockResolvedValue(null)
    return
  }
  vi.mocked(getSession).mockResolvedValue({ discordId: ME, createdAt: Date.now() })
  if (roles instanceof Error) vi.mocked(getUserRoles).mockRejectedValue(roles)
  else vi.mocked(getUserRoles).mockResolvedValue(roles)
}

const post = (body: unknown) =>
  new Request('http://x/api/admin/shop/items', { method: 'POST', body: JSON.stringify(body) })
const ctx = (id = '1') => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('canManageShop / requireShopAdmin', () => {
  it('admins may manage the shop', async () => {
    as([ADMIN])
    expect(await canManageShop(ME)).toBe(true)
    expect((await requireShopAdmin()).ok).toBe(true)
  })

  it('Pepperoni Mafia may manage the shop without being an admin', async () => {
    as([PEPPERONI_MAFIA, '1234567'])
    expect(await canManageShop(ME)).toBe(true)
    expect((await requireShopAdmin()).ok).toBe(true)
  })

  it('other members get 403', async () => {
    as(['1234567', '839206162837798945']) // Pizza Capo reviews missions but is not a shop admin
    expect(await canManageShop(ME)).toBe(false)
    const r = await requireShopAdmin()
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.response.status).toBe(403)
  })

  it('fails closed on a roles lookup error, and 401 without a session', async () => {
    as(new Error('discord down'))
    expect(await canManageShop(ME)).toBe(false)
    as(null)
    const r = await requireShopAdmin()
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.response.status).toBe(401)
    expect(await canManageShop(undefined)).toBe(false)
  })
})

describe('/api/admin/shop routes are guarded', () => {
  const body = { name: 'Hat', price: 10, quantity: -1, isAvailable: true, isCollectible: false }

  it('non-admins are refused before anything runs', async () => {
    as(['1234567'])
    expect((await createRoute(post(body), ctx())).status).toBe(403)
    expect((await deleteRoute(new Request('http://x', { method: 'DELETE' }), ctx())).status).toBe(403)
    expect((await grantRoute(post({ recipient: '1', itemId: 1, quantity: 1, reason: 'abc' }), ctx())).status).toBe(403)
    expect((await overviewRoute(new Request('http://x'), ctx())).status).toBe(403)
    expect(createShopItem).not.toHaveBeenCalled()
    expect(deleteShopItem).not.toHaveBeenCalled()
    expect(adminGrantItem).not.toHaveBeenCalled()
    expect(getShopAdminOverview).not.toHaveBeenCalled()
  })

  it('logged-out callers get 401', async () => {
    as(null)
    expect((await createRoute(post(body), ctx())).status).toBe(401)
  })

  it('a shop admin (Pepperoni Mafia) gets through, acting as themselves', async () => {
    as([PEPPERONI_MAFIA])
    const res = await createRoute(post(body), ctx())
    expect(res.status).toBe(200)
    expect(createShopItem).toHaveBeenCalledWith(ME, body)
    expect(res.headers.get('cache-control')).toContain('no-store')
  })

  it('validation errors come back as 400 (bad JSON, bad item id)', async () => {
    as([ADMIN])
    const bad = new Request('http://x', { method: 'POST', body: '{nope' })
    expect((await createRoute(bad, ctx())).status).toBe(400)
    expect((await deleteRoute(new Request('http://x', { method: 'DELETE' }), ctx('abc'))).status).toBe(400)
    expect(deleteShopItem).not.toHaveBeenCalled()
  })
})
