import { prisma } from './db'

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
    economy = await prisma.economy.create({
      data: { id: userId, wallet: 0, bank: 0 }
    })
  }

  return economy
}

/**
 * Get user's balance (wallet + bank)
 */
export async function getBalance(userId: string) {
  const economy = await getOrCreateEconomy(userId)
  return {
    wallet: economy.wallet,
    bank: economy.bank,
    total: economy.wallet + economy.bank
  }
}

/**
 * Add or subtract from user's wallet
 */
export async function updateWallet(userId: string, amount: number) {
  const economy = await getOrCreateEconomy(userId)

  if (economy.wallet + amount < 0) {
    throw new Error('Insufficient funds in wallet')
  }

  return prisma.economy.update({
    where: { id: userId },
    data: { wallet: economy.wallet + amount }
  })
}

/**
 * Transfer currency between users
 */
export async function transfer(fromId: string, toId: string, amount: number) {
  if (amount <= 0) {
    throw new Error('Amount must be positive')
  }

  if (fromId === toId) {
    throw new Error('Cannot transfer to yourself')
  }

  const fromEconomy = await getOrCreateEconomy(fromId)
  await getOrCreateEconomy(toId) // Ensure recipient exists

  if (fromEconomy.wallet < amount) {
    throw new Error('Insufficient funds in wallet')
  }

  // Use transaction to ensure atomicity
  await prisma.$transaction([
    prisma.economy.update({
      where: { id: fromId },
      data: { wallet: { decrement: amount } }
    }),
    prisma.economy.update({
      where: { id: toId },
      data: { wallet: { increment: amount } }
    })
  ])

  return { success: true, amount }
}

/**
 * Deposit from wallet to bank
 */
export async function deposit(userId: string, amount: number) {
  if (amount <= 0) {
    throw new Error('Amount must be positive')
  }

  const economy = await getOrCreateEconomy(userId)

  if (economy.wallet < amount) {
    throw new Error('Insufficient funds in wallet')
  }

  return prisma.economy.update({
    where: { id: userId },
    data: {
      wallet: { decrement: amount },
      bank: { increment: amount }
    }
  })
}

/**
 * Withdraw from bank to wallet
 */
export async function withdraw(userId: string, amount: number) {
  if (amount <= 0) {
    throw new Error('Amount must be positive')
  }

  const economy = await getOrCreateEconomy(userId)

  if (economy.bank < amount) {
    throw new Error('Insufficient funds in bank')
  }

  return prisma.economy.update({
    where: { id: userId },
    data: {
      bank: { decrement: amount },
      wallet: { increment: amount }
    }
  })
}

/**
 * Get leaderboard (top users by total balance)
 */
export async function getLeaderboard(limit = 10) {
  const economies = await prisma.economy.findMany({
    orderBy: [
      { wallet: 'desc' },
      { bank: 'desc' }
    ],
    take: limit * 2 // Fetch more to sort properly
  })

  // Sort by total and take top N
  return economies
    .map(e => ({
      userId: e.id,
      wallet: e.wallet,
      bank: e.bank,
      total: e.wallet + e.bank
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit)
}

/**
 * Check if user is onboarded (has completed profile)
 * This checks if user exists in Google Sheets via member lookup
 */
export async function isOnboarded(userId: string): Promise<boolean> {
  // Check if user has a User record (authenticated via Discord)
  const user = await prisma.user.findUnique({
    where: { id: userId }
  })
  return !!user
}

/**
 * Require user to be onboarded before economy access
 */
export async function requireOnboarded(userId: string) {
  const onboarded = await isOnboarded(userId)
  if (!onboarded) {
    throw new Error('You must complete onboarding before using the economy')
  }
}
