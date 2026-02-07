import { prisma } from './db'
import { Prisma } from '@prisma/client'

// Accept either the global prisma client or a transaction client
type PrismaClientLike = Prisma.TransactionClient | typeof prisma

/**
 * Log a transaction and record the running balance.
 * Can be called with the global prisma client or inside a $transaction block.
 */
export async function logTransaction(
  client: PrismaClientLike,
  userId: string,
  type: Prisma.TransactionCreateInput['type'],
  amount: number,
  description: string,
  metadata?: Record<string, unknown>
) {
  // Read the current wallet balance to store as running balance
  const economy = await client.economy.findUnique({ where: { id: userId } })
  const balance = economy?.wallet ?? 0

  return client.transaction.create({
    data: {
      userId,
      type,
      amount,
      balance,
      description,
      metadata: metadata ?? Prisma.JsonNull,
    },
  })
}

/**
 * Get paginated transaction history for a user (newest first).
 */
export async function getTransactionHistory(
  userId: string,
  limit = 20,
  offset = 0
) {
  const [transactions, total] = await Promise.all([
    prisma.transaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.transaction.count({ where: { userId } }),
  ])

  return { transactions, total }
}
