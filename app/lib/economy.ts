import { prisma } from './db'
import { ValidationError } from './errors/api-errors'
import { logTransaction } from './transactions'

const PEP_SYMBOL = process.env.PEP_SYMBOL || '$PEP'
const PEP_NAME = process.env.PEP_NAME || 'PEP'

export { PEP_SYMBOL, PEP_NAME }

export function formatCurrency(amount: number): string {
  return `${PEP_SYMBOL}${amount.toLocaleString()}`
}

/**
 * Get or create economy record for a user
 */
export async function getOrCreateEconomy(userId: string) {
  let economy = await prisma.economy.findUnique({
    where: { id: userId }
  })

  if (!economy) {
    // Ensure User record exists first (required by foreign key)
    await prisma.user.upsert({
      where: { id: userId },
      create: { id: userId, roles: [] },
      update: {}
    })

    economy = await prisma.economy.create({
      data: { id: userId, wallet: 0 }
    })
  }

  return economy
}

/**
 * Get user's balance
 */
export async function getBalance(userId: string) {
  const economy = await getOrCreateEconomy(userId)
  return { balance: economy.wallet }
}

/**
 * Add or subtract from user's balance
 */
export async function updateBalance(userId: string, amount: number) {
  const economy = await getOrCreateEconomy(userId)

  if (economy.wallet + amount < 0) {
    throw new ValidationError('Insufficient funds')
  }

  return prisma.economy.update({
    where: { id: userId },
    data: { wallet: economy.wallet + amount }
  })
}

// Alias for backward compatibility
export const updateWallet = updateBalance

/**
 * Transfer currency between users
 */
export async function transfer(fromId: string, toId: string, amount: number) {
  if (amount <= 0) {
    throw new ValidationError('Amount must be positive')
  }

  if (fromId === toId) {
    throw new ValidationError('Cannot transfer to yourself')
  }

  const fromEconomy = await getOrCreateEconomy(fromId)
  await getOrCreateEconomy(toId) // Ensure recipient exists

  if (fromEconomy.wallet < amount) {
    throw new ValidationError('Insufficient funds')
  }

  // Use interactive transaction to ensure atomicity and log both sides
  await prisma.$transaction(async (tx) => {
    await tx.economy.update({
      where: { id: fromId },
      data: { wallet: { decrement: amount } }
    })
    await tx.economy.update({
      where: { id: toId },
      data: { wallet: { increment: amount } }
    })

    // Log both sides of the transfer
    await logTransaction(tx, fromId, 'TRANSFER_SENT', -amount, `Transfer to ${toId}`, { toUserId: toId })
    await logTransaction(tx, toId, 'TRANSFER_RECEIVED', amount, `Transfer from ${fromId}`, { fromUserId: fromId })
  })

  return { success: true, amount }
}

/**
 * Get leaderboard (top users by balance)
 */
export async function getLeaderboard(limit = 10) {
  const economies = await prisma.economy.findMany({
    orderBy: { wallet: 'desc' },
    take: limit
  })

  return economies.map(e => ({
    userId: e.id,
    balance: e.wallet
  }))
}

/**
 * Ensure user exists in database (auto-create if needed)
 */
export async function ensureUser(userId: string) {
  await prisma.user.upsert({
    where: { id: userId },
    create: { id: userId, roles: [] },
    update: {}
  })
}

/**
 * Check if user is onboarded (has completed profile)
 */
export async function isOnboarded(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId }
  })
  return !!user
}

/**
 * Require user to be onboarded before economy access
 * Auto-creates User record if it doesn't exist
 */
export async function requireOnboarded(userId: string) {
  // Auto-create user record if it doesn't exist
  await prisma.user.upsert({
    where: { id: userId },
    create: { id: userId, roles: [] },
    update: {}
  })
}
