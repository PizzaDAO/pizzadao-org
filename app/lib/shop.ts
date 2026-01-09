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
    // Deduct from wallet
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
