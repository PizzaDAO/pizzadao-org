// @vitest-environment node
// The Google-Sheet shop sync is retired: POST /api/shop/sync is a no-op
// unless SHOP_SHEET_SYNC_ENABLED=1, so a stray Apps Script push can't
// overwrite /admin/shop edits. The secret is still checked first.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/app/lib/db', () => ({ prisma: {} }))
vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/app/lib/shop', async (orig) => ({
  ...(await orig<typeof import('@/app/lib/shop')>()),
  syncShopItemsFromData: vi.fn().mockResolvedValue({ synced: 1, added: 1, updated: 0, deactivated: 3, skippedCollectibles: [] }),
}))

import { GET, POST } from './route'
import { shopSheetSyncEnabled, syncShopItemsFromData } from '@/app/lib/shop'

const SECRET = 'test-sync-secret'
const push = (secret = SECRET) =>
  POST(
    new Request('http://x/api/shop/sync', {
      method: 'POST',
      headers: { 'x-sync-secret': secret, 'content-type': 'application/json' },
      body: JSON.stringify({ items: [{ name: 'Pizza Box', price: 10 }] }),
    }) as never,
  )

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('JOB_SYNC_SECRET', SECRET)
})
afterEach(() => vi.unstubAllEnvs())

describe('POST /api/shop/sync', () => {
  it('is a no-op without SHOP_SHEET_SYNC_ENABLED', async () => {
    vi.stubEnv('SHOP_SHEET_SYNC_ENABLED', '')
    const res = await push()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, skipped: true })
    expect(syncShopItemsFromData).not.toHaveBeenCalled()
  })

  it('is a no-op for any value other than "1"', async () => {
    for (const v of ['0', 'true', 'yes', '2']) {
      vi.stubEnv('SHOP_SHEET_SYNC_ENABLED', v)
      expect(await (await push()).json()).toMatchObject({ skipped: true })
    }
    expect(syncShopItemsFromData).not.toHaveBeenCalled()
  })

  it('syncs when SHOP_SHEET_SYNC_ENABLED=1', async () => {
    vi.stubEnv('SHOP_SHEET_SYNC_ENABLED', '1')
    const res = await push()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, added: 1 })
    expect(syncShopItemsFromData).toHaveBeenCalledTimes(1)
  })

  it('still rejects a wrong secret, flag on or off', async () => {
    for (const v of ['', '1']) {
      vi.stubEnv('SHOP_SHEET_SYNC_ENABLED', v)
      expect((await push('wrong')).status).toBe(401)
    }
    expect(syncShopItemsFromData).not.toHaveBeenCalled()
  })

  it('GET reports whether the sync is enabled', async () => {
    vi.stubEnv('SHOP_SHEET_SYNC_ENABLED', '')
    expect(await (await GET()).json()).toMatchObject({ enabled: false })
    vi.stubEnv('SHOP_SHEET_SYNC_ENABLED', '1')
    expect(await (await GET()).json()).toMatchObject({ enabled: true })
  })

  it('shopSheetSyncEnabled only accepts "1"', () => {
    expect(shopSheetSyncEnabled({})).toBe(false)
    expect(shopSheetSyncEnabled({ SHOP_SHEET_SYNC_ENABLED: ' 1 ' })).toBe(true)
    expect(shopSheetSyncEnabled({ SHOP_SHEET_SYNC_ENABLED: 'true' })).toBe(false)
  })
})
