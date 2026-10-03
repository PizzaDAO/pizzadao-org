import { Prisma } from '@prisma/client'
import { prisma } from './db'
import { ValidationError } from './errors/api-errors'
import { logTransaction } from './transactions'

const PEP_SYMBOL = process.env.PEP_SYMBOL || '$PEP'
const PEP_NAME = process.env.PEP_NAME || 'PEP'

export { PEP_SYMBOL, PEP_NAME }

type TxClient = Prisma.TransactionClient
type TransactionType = Prisma.TransactionCreateInput['type']

export function formatCurrency(amount: number): string {
  return `${PEP_SYMBOL}${amount.toLocaleString()}`
}

/**
 * Get or create economy record for a user.
 *
 * Upserts, so two concurrent first requests for the same user can't both try
 * to INSERT and fail one of them on the primary key.
 */
export async function getOrCreateEconomy(userId: string) {
  const existing = await prisma.economy.findUnique({ where: { id: userId } })
  if (existing) return existing

  // Ensure User record exists first (required by foreign key)
  await prisma.user.upsert({
    where: { id: userId },
    create: { id: userId, roles: [] },
    update: {}
  })

  try {
    return await prisma.economy.upsert({
      where: { id: userId },
      create: { id: userId, wallet: 0 },
      update: {}
    })
  } catch (e: unknown) {
    // Lost a concurrent INSERT race: the row exists now.
    if ((e as { code?: string })?.code === 'P2002') {
      return prisma.economy.findUniqueOrThrow({ where: { id: userId } })
    }
    throw e
  }
}

/**
 * Get user's balance
 */
export async function getBalance(userId: string) {
  const economy = await getOrCreateEconomy(userId)
  return { balance: economy.wallet }
}

/** PEP amounts are positive whole numbers that fit Postgres INT4. */
export function assertPepAmount(amount: number, label = 'Amount') {
  if (!Number.isInteger(amount) || amount <= 0 || amount > 2_147_483_647) {
    throw new ValidationError(`${label} must be positive and a whole number`)
  }
}

/**
 * Credit a wallet and write its ledger row, inside the caller's DB transaction.
 *
 * Together with debitInTx this is the only way balances change: the wallet
 * update and the Transaction row commit or roll back together, so
 * Economy.wallet can't drift from the ledger. The wallet row must already
 * exist (call getOrCreateEconomy before opening the transaction).
 */
export async function creditInTx(
  tx: TxClient,
  userId: string,
  amount: number,
  type: TransactionType,
  description: string,
  metadata?: Prisma.InputJsonValue,
) {
  assertPepAmount(amount)
  await tx.economy.update({
    where: { id: userId },
    data: { wallet: { increment: amount } }
  })
  await logTransaction(tx, userId, type, amount, description, metadata)
}

/**
 * Debit a wallet and write its ledger row, inside the caller's DB transaction.
 *
 * The debit is a conditional UPDATE (wallet >= amount), atomic in Postgres, so
 * concurrent debits can never overdraw. Throws ValidationError('Insufficient
 * funds') — rolling back the caller's transaction — when funds don't suffice.
 */
export async function debitInTx(
  tx: TxClient,
  userId: string,
  amount: number,
  type: TransactionType,
  description: string,
  metadata?: Prisma.InputJsonValue,
) {
  assertPepAmount(amount)
  const debit = await tx.economy.updateMany({
    where: { id: userId, wallet: { gte: amount } },
    data: { wallet: { decrement: amount } }
  })
  if (debit.count !== 1) {
    throw new ValidationError('Insufficient funds')
  }
  await logTransaction(tx, userId, type, -amount, description, metadata)
}

/**
 * Take a row lock on a user's wallet for the rest of the DB transaction.
 * Serializes per-user check-then-pay logic (e.g. "was this reward paid yet?").
 */
export async function lockWallet(tx: TxClient, userId: string) {
  await tx.$queryRaw`SELECT id FROM "Economy" WHERE id = ${userId} FOR UPDATE`
}

/**
 * Transfer currency between users
 */
export async function transfer(fromId: string, toId: string, amount: number) {
  assertPepAmount(amount)

  if (fromId === toId) {
    throw new ValidationError('Cannot transfer to yourself')
  }

  const fromEconomy = await getOrCreateEconomy(fromId)
  await getOrCreateEconomy(toId) // Ensure recipient exists

  // Friendly fast path; the conditional debit in debitInTx is authoritative.
  if (fromEconomy.wallet < amount) {
    throw new ValidationError('Insufficient funds')
  }

  // Debit, credit and both ledger rows commit together or not at all.
  await prisma.$transaction(async (tx) => {
    // Lock both wallets in a fixed (id) order first. Without this, A->B racing
    // B->A locks the rows in opposite orders and Postgres aborts one of them
    // with "deadlock detected" (found by the concurrency suite).
    for (const id of [fromId, toId].sort()) await lockWallet(tx, id)
    await debitInTx(tx, fromId, amount, 'TRANSFER_SENT', `Transfer to ${toId}`, { toUserId: toId })
    await creditInTx(tx, toId, amount, 'TRANSFER_RECEIVED', `Transfer from ${fromId}`, { fromUserId: fromId })
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

  return economies.map((e: any) => ({
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
