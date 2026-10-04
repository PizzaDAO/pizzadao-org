// @vitest-environment node
//
// Collectibles (ShopItem.isCollectible, e.g. the retired UnbelievaBoat Molto
// Benny Pin): held and shown in inventories, never for sale, and never
// touched by the shop-sheet sync. Every purchase path is exercised here:
// GET /api/shop, POST /api/shop/buy, Discord /shop, /buy and its
// autocomplete, and buyItem itself.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('./db')
vi.mock('./session', () => ({ getSession: vi.fn() }))
vi.mock('./economy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./economy')>()),
  getOrCreateEconomy: vi.fn(async (id: string) => ({ id, wallet: 1_000_000 })),
  requireOnboarded: vi.fn(async () => undefined),
}))

import { prisma } from './db'
import { getSession } from './session'
import { buyItem, getShopItems, getInventory, syncShopItemsFromData } from './shop'
import { handleInteraction, type HandlerDeps } from './discord-interactions/handle'
import { GET as shopGET } from '@/app/api/shop/route'
import { POST as buyPOST } from '@/app/api/shop/buy/route'
import { GET as inventoryGET } from '@/app/api/inventory/route'

const mockFn = (f: unknown) => f as ReturnType<typeof vi.fn>
const USER = '100000000000000001'

type Item = { id: number; name: string; description: string | null; price: number; quantity: number; image: string | null; isAvailable: boolean; isCollectible: boolean }
const STICKS: Item = { id: 1, name: 'Pizza Sticks', description: 'Pizza Sticks.', price: 1337, quantity: -1, image: null, isAvailable: true, isCollectible: false }
const PIN: Item = {
  id: 7,
  name: 'Molto Benny Pin',
  description: 'Retired collectible.',
  price: 0,
  quantity: 0,
  image: '/brand-kit/molto-benny/molto-benny-color.png',
  isAvailable: false,
  isCollectible: true,
}
// Defence in depth: even a collectible that somehow got isAvailable=true and a
// positive price (e.g. a hand edit) must not be sellable.
const PIN_MISFLAGGED: Item = { ...PIN, id: 8, name: 'Benny Pin Misflagged', price: 500, quantity: -1, isAvailable: true }
let items: Item[] = []

function matches(it: Item, where: Record<string, unknown> = {}) {
  return Object.entries(where).every(([k, v]) => (it as Record<string, unknown>)[k] === v)
}

beforeEach(() => {
  vi.clearAllMocks()
  items = [STICKS, PIN, PIN_MISFLAGGED].map((i) => ({ ...i }))
  mockFn(prisma.shopItem.findMany).mockImplementation(async (args?: { where?: Record<string, unknown> }) => items.filter((i) => matches(i, args?.where)))
  mockFn(prisma.shopItem.findUnique).mockImplementation(async ({ where }: { where: { id?: number; name?: string } }) =>
    items.find((i) => (where.id !== undefined ? i.id === where.id : i.name === where.name)) ?? null,
  )
  mockFn(prisma.$transaction).mockImplementation(async () => {
    throw new Error('a collectible purchase must never reach the DB transaction')
  })
  mockFn(getSession).mockResolvedValue({ discordId: USER })
})

describe('collectibles are not purchasable', () => {
  it('getShopItems (web shop, Discord /shop, /buy, autocomplete) only lists items for sale', async () => {
    const list = await getShopItems()
    expect(list.map((i) => i.name)).toEqual(['Pizza Sticks'])
    expect(prisma.shopItem.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { isAvailable: true, isCollectible: false } }))
  })

  it('buyItem refuses a collectible before touching the wallet, stock or inventory', async () => {
    await expect(buyItem(USER, PIN.id, 1)).rejects.toThrow(/not available|collectible/)
    await expect(buyItem(USER, PIN_MISFLAGGED.id, 1)).rejects.toThrow(/collectible and is not for sale/)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('GET /api/shop hides collectibles', async () => {
    const res = await shopGET()
    const body = await res.json()
    const names = JSON.stringify(body)
    expect(names).toContain('Pizza Sticks')
    expect(names).not.toContain('Benny')
  })

  it('POST /api/shop/buy refuses a collectible with a 400', async () => {
    for (const id of [PIN.id, PIN_MISFLAGGED.id]) {
      const req = new NextRequest('http://localhost/api/shop/buy', { method: 'POST', body: JSON.stringify({ itemId: id, quantity: 1 }) })
      const res = await buyPOST(req)
      expect(res.status).toBe(400)
    }
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('Discord /shop does not list it; /buy (by name or id) and autocomplete cannot reach it', async () => {
    const buy = vi.fn((id: string, itemId: number, qty: number) => buyItem(id, itemId, qty))
    const deps = { guildId: 'g', currency: 'PEP', shopItems: getShopItems, buy } as unknown as HandlerDeps
    const cmd = (name: string, options?: Array<{ name: string; type: number; value: unknown; focused?: boolean }>, type = 2) => ({
      type,
      guild_id: 'g',
      member: { user: { id: USER, username: 'snax' }, roles: [] },
      data: { name, options },
    })
    const text = (r: unknown) => JSON.stringify(r)

    const shop = text(await handleInteraction(cmd('shop'), deps))
    expect(shop).toContain('Pizza Sticks')
    expect(shop).not.toContain('Benny')

    for (const value of ['Molto Benny Pin', 'moltobennypin', String(PIN.id), String(PIN_MISFLAGGED.id), 'Benny Pin Misflagged']) {
      const r = text(await handleInteraction(cmd('buy', [{ name: 'item', type: 3, value }]), deps))
      expect(r).toMatch(/No shop item called/)
    }
    expect(buy).not.toHaveBeenCalled()

    const ac = (await handleInteraction(cmd('buy', [{ name: 'item', type: 3, value: 'benny', focused: true }], 4), deps)) as {
      data: { choices: unknown[] }
    }
    expect(ac.data.choices).toEqual([])
  })
})

describe('collectibles still show in inventories', () => {
  it('getInventory does not filter collectibles and /api/inventory returns them flagged', async () => {
    const rows = [
      { userId: USER, itemId: STICKS.id, quantity: 2, item: items[0] },
      { userId: USER, itemId: PIN.id, quantity: 1, item: items[1] },
    ]
    mockFn(prisma.inventory.findMany).mockResolvedValue(rows)
    expect(await getInventory(USER)).toHaveLength(2)
    expect(prisma.inventory.findMany).toHaveBeenCalledWith({ where: { userId: USER }, include: { item: true } })

    const body = await (await inventoryGET()).json()
    const pin = body.inventory.find((i: { itemId: number }) => i.itemId === PIN.id)
    expect(pin).toMatchObject({ name: 'Molto Benny Pin', quantity: 1, isCollectible: true, item: { name: 'Molto Benny Pin', image: PIN.image, isCollectible: true } })
    expect(body.inventory.find((i: { itemId: number }) => i.itemId === STICKS.id)).toMatchObject({ isCollectible: false, item: { name: 'Pizza Sticks' } })
  })
})

describe('sheet sync never touches collectibles', () => {
  it('does not deactivate a collectible missing from the sheet (but still deactivates other missing items)', async () => {
    const gone: Item = { ...STICKS, id: 3, name: 'Old Thing' }
    items.push(gone)
    mockFn(prisma.shopItem.update).mockResolvedValue({})
    const r = await syncShopItemsFromData([{ name: 'Pizza Sticks', description: 'Pizza Sticks.', price: 1337, quantity: -1 }])
    expect(r.deactivated).toBe(1)
    const updatedIds = mockFn(prisma.shopItem.update).mock.calls.map((c) => c[0].where.id)
    expect(updatedIds).toEqual([gone.id])
    expect(updatedIds).not.toContain(PIN.id)
    expect(updatedIds).not.toContain(PIN_MISFLAGGED.id)
    expect(prisma.shopItem.delete).not.toHaveBeenCalled()
    expect(prisma.shopItem.deleteMany).not.toHaveBeenCalled()
  })

  it('ignores a sheet row with a collectible name (cannot make it buyable) and reports it', async () => {
    mockFn(prisma.shopItem.update).mockResolvedValue({})
    const r = await syncShopItemsFromData([
      { name: 'Pizza Sticks', description: 'Pizza Sticks.', price: 1337, quantity: -1 },
      { name: 'Molto Benny Pin', description: 'now for sale?', price: 100, quantity: -1 },
    ])
    expect(r.skippedCollectibles).toEqual(['Molto Benny Pin'])
    expect(prisma.shopItem.create).not.toHaveBeenCalled()
    for (const [arg] of mockFn(prisma.shopItem.update).mock.calls) expect(arg.where.id).not.toBe(PIN.id)
  })
})
