import { prisma } from './db'
import { assertPepAmount, debitInTx, getOrCreateEconomy } from './economy'
import { ConflictError, NotFoundError, ValidationError } from './errors/api-errors'

/**
 * Get all items for sale (web shop, Discord /shop, /buy and its autocomplete).
 * Collectibles are never for sale, so they are left out here; inventories
 * (getInventory) still show them.
 */
export async function getShopItems() {
  return prisma.shopItem.findMany({
    where: { isAvailable: true, isCollectible: false },
    orderBy: { price: 'asc' }
  })
}

/**
 * Get a specific shop item by ID
 */
export async function getShopItem(itemId: number) {
  return prisma.shopItem.findUnique({
    where: { id: itemId }
  })
}

/**
 * Get a specific shop item by name
 */
export async function getShopItemByName(name: string) {
  return prisma.shopItem.findUnique({
    where: { name }
  })
}

/**
 * Buy an item from the shop
 */
export async function buyItem(userId: string, itemId: number, quantity = 1) {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new ValidationError('Quantity must be a positive whole number')
  }

  const item = await prisma.shopItem.findUnique({
    where: { id: itemId }
  })

  if (!item) {
    throw new NotFoundError('Item')
  }

  if (!item.isAvailable) {
    throw new ValidationError('Item is not available')
  }

  // Collectibles (e.g. the retired Molto Benny Pin) can be held, never bought.
  if (item.isCollectible) {
    throw new ValidationError('That item is a collectible and is not for sale')
  }

  // A zero/negative/fractional price (e.g. a bad row from the shop sheet sync)
  // would turn a purchase into a mint. Refuse it.
  if (!Number.isInteger(item.price) || item.price <= 0) {
    throw new ValidationError('Item is not available')
  }

  // Check stock (quantity = -1 means unlimited)
  if (item.quantity !== -1 && item.quantity < quantity) {
    throw new ValidationError(`Not enough stock. Only ${item.quantity} available.`)
  }

  const totalCost = item.price * quantity
  assertPepAmount(totalCost, 'Total cost')
  const economy = await getOrCreateEconomy(userId)

  if (economy.wallet < totalCost) {
    throw new ValidationError(`Insufficient funds. Need ${totalCost}, have ${economy.wallet}`)
  }

  // One DB transaction: conditional debit + ledger row, conditional stock
  // decrement, inventory credit. Both conditional updates are atomic in
  // Postgres, so concurrent purchases can't overdraw the wallet or oversell
  // limited stock; any failure rolls back the whole purchase.
  await prisma.$transaction(async (tx) => {
    await debitInTx(tx, userId, totalCost, 'SHOP_PURCHASE', `Purchased ${quantity}x ${item.name}`, { itemId, itemName: item.name, quantity })

    // Reduce stock if not unlimited
    if (item.quantity !== -1) {
      const stock = await tx.shopItem.updateMany({
        where: { id: itemId, isAvailable: true, isCollectible: false, quantity: { gte: quantity } },
        data: { quantity: { decrement: quantity } }
      })
      if (stock.count !== 1) {
        throw new ConflictError('Not enough stock')
      }
    }

    // Add to inventory (upsert)
    await tx.inventory.upsert({
      where: {
        userId_itemId: { userId, itemId }
      },
      create: {
        userId,
        itemId,
        quantity
      },
      update: {
        quantity: { increment: quantity }
      }
    })
  })

  return {
    success: true,
    item: item.name,
    quantity,
    totalCost
  }
}

/**
 * Get user's inventory
 */
export async function getInventory(userId: string) {
  return prisma.inventory.findMany({
    where: { userId },
    include: { item: true }
  })
}

/**
 * Check if user has an item in inventory
 */
export async function hasItem(userId: string, itemId: number, quantity = 1) {
  const inv = await prisma.inventory.findUnique({
    where: {
      userId_itemId: { userId, itemId }
    }
  })
  return inv && inv.quantity >= quantity
}

/**
 * Remove item from user's inventory (for redemption)
 */
export async function removeFromInventory(userId: string, itemId: number, quantity = 1) {
  const inv = await prisma.inventory.findUnique({
    where: {
      userId_itemId: { userId, itemId }
    }
  })

  if (!inv || inv.quantity < quantity) {
    throw new Error('Insufficient items in inventory')
  }

  if (inv.quantity === quantity) {
    // Remove the record entirely
    await prisma.inventory.delete({
      where: {
        userId_itemId: { userId, itemId }
      }
    })
  } else {
    // Decrement quantity
    await prisma.inventory.update({
      where: {
        userId_itemId: { userId, itemId }
      },
      data: { quantity: { decrement: quantity } }
    })
  }

  return { success: true }
}

// ===== Sync from Google Sheets =====
//
// RETIRED: the shop is managed at /admin/shop (app/lib/shop-admin.ts). POST
// /api/shop/sync is a no-op unless SHOP_SHEET_SYNC_ENABLED=1, so a stray
// Apps Script push can't overwrite admin edits.

/** The sheet sync only runs when SHOP_SHEET_SYNC_ENABLED is exactly "1". */
export const shopSheetSyncEnabled = (env: Record<string, string | undefined> = process.env) =>
  env.SHOP_SHEET_SYNC_ENABLED?.trim() === '1'

interface ShopItemData {
  name: string
  description?: string
  price: number
  quantity?: number
  image?: string
}

/**
 * Sync shop items from data array (from Google Apps Script webhook).
 *
 * Collectibles are outside the sheet's control: they are never deactivated
 * when missing from the sheet, and a sheet row with a collectible's name is
 * ignored (reported in `skippedCollectibles`) so it can't make one buyable.
 */
export async function syncShopItemsFromData(items: ShopItemData[]) {
  if (items.length === 0) {
    return { synced: 0, added: 0, updated: 0, deactivated: 0, skippedCollectibles: [] as string[] }
  }

  // Get current items
  const currentItems = await prisma.shopItem.findMany()
  const currentByName = new Map(currentItems.map((i: any) => [i.name, i]))

  let added = 0
  let updated = 0
  const seenNames = new Set<string>()
  const skippedCollectibles: string[] = []

  // Add or update items
  for (const item of items) {
    if (!item.name || item.price === undefined) continue
    // Skip rows with a price that would make a purchase mint PEP (<= 0) or
    // break integer accounting; the existing item is then deactivated below.
    if (!Number.isInteger(item.price) || item.price <= 0) continue
    if (item.quantity !== undefined && (!Number.isInteger(item.quantity) || item.quantity < -1)) continue

    seenNames.add(item.name)
    const existing = currentByName.get(item.name)

    if (existing?.isCollectible) {
      skippedCollectibles.push(item.name)
      continue
    }

    if (existing) {
      // Update if any field changed or was unavailable
      const needsUpdate =
        existing.description !== (item.description || null) ||
        existing.price !== item.price ||
        existing.quantity !== (item.quantity ?? -1) ||
        existing.image !== (item.image || null) ||
        !existing.isAvailable

      if (needsUpdate) {
        await prisma.shopItem.update({
          where: { id: existing.id },
          data: {
            description: item.description || null,
            price: item.price,
            quantity: item.quantity ?? -1,
            image: item.image || null,
            isAvailable: true
          }
        })
        updated++
      }
    } else {
      // Add new item
      await prisma.shopItem.create({
        data: {
          name: item.name,
          description: item.description || null,
          price: item.price,
          quantity: item.quantity ?? -1,
          image: item.image || null,
          isAvailable: true
        }
      })
      added++
    }
  }

  // Deactivate items no longer in sheet
  let deactivated = 0
  for (const item of currentItems) {
    if (item.isAvailable && !item.isCollectible && !seenNames.has(item.name)) {
      await prisma.shopItem.update({
        where: { id: item.id },
        data: { isAvailable: false }
      })
      deactivated++
    }
  }

  return { synced: items.length, added, updated, deactivated, skippedCollectibles }
}

// ===== Admin Functions =====
//
// Item create / edit / hide / restock / delete and admin grants live in
// app/lib/shop-admin.ts: every change there is audited (ShopAdminEvent).
