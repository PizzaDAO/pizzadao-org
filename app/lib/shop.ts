import { prisma } from './db'
import { getOrCreateEconomy } from './economy'

/**
 * Get all available shop items
 */
export async function getShopItems() {
  return prisma.shopItem.findMany({
    where: { isAvailable: true },
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
  if (quantity <= 0) {
    throw new Error('Quantity must be positive')
  }

  const item = await prisma.shopItem.findUnique({
    where: { id: itemId }
  })

  if (!item) {
    throw new Error('Item not found')
  }

  if (!item.isAvailable) {
    throw new Error('Item is not available')
  }

  // Check stock (quantity = -1 means unlimited)
  if (item.quantity !== -1 && item.quantity < quantity) {
    throw new Error(`Not enough stock. Only ${item.quantity} available.`)
  }

  const totalCost = item.price * quantity
  const economy = await getOrCreateEconomy(userId)

  if (economy.wallet < totalCost) {
    throw new Error(`Insufficient funds. Need ${totalCost}, have ${economy.wallet}`)
  }

  // Use transaction for atomicity
  await prisma.$transaction(async (tx) => {
    // Deduct from balance
    await tx.economy.update({
      where: { id: userId },
      data: { wallet: { decrement: totalCost } }
    })

    // Reduce stock if not unlimited
    if (item.quantity !== -1) {
      await tx.shopItem.update({
        where: { id: itemId },
        data: { quantity: { decrement: quantity } }
      })
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

interface ShopItemData {
  name: string
  description?: string
  price: number
  quantity?: number
  image?: string
}

/**
 * Sync shop items from data array (from Google Apps Script webhook)
 */
export async function syncShopItemsFromData(items: ShopItemData[]) {
  if (items.length === 0) {
    return { synced: 0, added: 0, updated: 0, deactivated: 0 }
  }

  // Get current items
  const currentItems = await prisma.shopItem.findMany()
  const currentByName = new Map(currentItems.map(i => [i.name, i]))

  let added = 0
  let updated = 0
  const seenNames = new Set<string>()

  // Add or update items
  for (const item of items) {
    if (!item.name || item.price === undefined) continue

    seenNames.add(item.name)
    const existing = currentByName.get(item.name)

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
    if (item.isAvailable && !seenNames.has(item.name)) {
      await prisma.shopItem.update({
        where: { id: item.id },
        data: { isAvailable: false }
      })
      deactivated++
    }
  }

  return { synced: items.length, added, updated, deactivated }
}

// ===== Admin Functions =====

/**
 * Add a new item to the shop (admin only)
 */
export async function addShopItem(
  name: string,
  price: number,
  description?: string,
  quantity = -1
) {
  return prisma.shopItem.create({
    data: {
      name,
      price,
      description,
      quantity,
      isAvailable: true
    }
  })
}

/**
 * Update a shop item (admin only)
 */
export async function updateShopItem(
  itemId: number,
  data: {
    name?: string
    price?: number
    description?: string
    quantity?: number
    isAvailable?: boolean
  }
) {
  return prisma.shopItem.update({
    where: { id: itemId },
    data
  })
}

/**
 * Remove a shop item (admin only)
 */
export async function removeShopItem(itemId: number) {
  return prisma.shopItem.update({
    where: { id: itemId },
    data: { isAvailable: false }
  })
}
