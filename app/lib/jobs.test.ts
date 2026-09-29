import { describe, it, expect, vi, beforeEach } from 'vitest'
import { completeJob, recordDailyJobCompletion } from './jobs'
import { prisma } from './db'

vi.mock('./db')
vi.mock('./economy', () => ({
  updateWallet: vi.fn().mockResolvedValue({}),
}))
vi.mock('./transactions', () => ({
  logTransaction: vi.fn().mockResolvedValue({
    id: 1,
    userId: '',
    type: '',
    amount: 0,
    balance: 0,
    description: '',
    metadata: null,
    createdAt: new Date(),
  }),
}))

import { updateWallet } from './economy'
import { logTransaction } from './transactions'

describe('completeJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should award reward and log a JOB_REWARD transaction', async () => {
    ;(prisma.jobAssignment.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 1,
      jobId: 7,
      userId: 'worker-1',
      job: { id: 7, description: 'Clean the kitchen', type: 'General', isActive: true },
    })
    ;(prisma.jobAssignment.delete as ReturnType<typeof vi.fn>).mockResolvedValue({})

    const result = await completeJob('worker-1', 50)

    expect(prisma.jobAssignment.delete).toHaveBeenCalledWith({ where: { id: 1 } })
    expect(updateWallet).toHaveBeenCalledWith('worker-1', 50)
    expect(logTransaction).toHaveBeenCalledWith(
      prisma,
      'worker-1',
      'JOB_REWARD',
      50,
      'Job reward: Clean the kitchen',
      { jobId: 7 }
    )
    expect(result).toEqual({
      success: true,
      job: expect.objectContaining({ id: 7, description: 'Clean the kitchen' }),
      reward: 50,
    })
  })

  it('should not log transaction when reward is zero', async () => {
    ;(prisma.jobAssignment.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 2,
      jobId: 8,
      userId: 'worker-1',
      job: { id: 8, description: 'Sweep the floor', type: 'General', isActive: true },
    })
    ;(prisma.jobAssignment.delete as ReturnType<typeof vi.fn>).mockResolvedValue({})

    await completeJob('worker-1', 0)

    expect(updateWallet).not.toHaveBeenCalled()
    expect(logTransaction).not.toHaveBeenCalled()
  })

  it('should throw when user has no active job', async () => {
    ;(prisma.jobAssignment.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)

    await expect(completeJob('worker-1', 50)).rejects.toThrow('User does not have an active job')
  })
})

describe('recordDailyJobCompletion', () => {
  function makeTx(opts: { movedCount: number; existing: unknown; createError?: unknown }) {
    return {
      jobAssignment: {
        updateMany: vi.fn().mockResolvedValue({ count: opts.movedCount }),
        findUnique: vi.fn().mockResolvedValue(opts.existing),
        create: opts.createError
          ? vi.fn().mockRejectedValue(opts.createError)
          : vi.fn().mockResolvedValue({ id: 1 }),
      },
      economy: { update: vi.fn().mockResolvedValue({}) },
    }
  }

  function runWith(tx: ReturnType<typeof makeTx>) {
    ;(prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
    )
    return recordDailyJobCompletion('worker-1', 7, 50, 'Daily job: x')
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('pays when an assignment from a previous day is moved to today', async () => {
    const tx = makeTx({ movedCount: 1, existing: null })
    await expect(runWith(tx)).resolves.toBe(true)
    expect(tx.jobAssignment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ jobId: 7, userId: 'worker-1', assignedAt: { lt: expect.any(Date) } }) }),
    )
    expect(tx.economy.update).toHaveBeenCalledWith({ where: { id: 'worker-1' }, data: { wallet: { increment: 50 } } })
    expect(logTransaction).toHaveBeenCalledWith(tx, 'worker-1', 'JOB_REWARD', 50, 'Daily job: x', { jobId: 7 })
  })

  it('pays on the first-ever completion', async () => {
    const tx = makeTx({ movedCount: 0, existing: null })
    await expect(runWith(tx)).resolves.toBe(true)
    expect(tx.jobAssignment.create).toHaveBeenCalledWith({ data: { jobId: 7, userId: 'worker-1' } })
    expect(tx.economy.update).toHaveBeenCalledTimes(1)
  })

  it('does not pay twice on the same day', async () => {
    const tx = makeTx({ movedCount: 0, existing: { id: 1, assignedAt: new Date() } })
    await expect(runWith(tx)).resolves.toBe(false)
    expect(tx.economy.update).not.toHaveBeenCalled()
  })

  it('does not pay when a concurrent first completion wins the unique constraint', async () => {
    const tx = makeTx({ movedCount: 0, existing: null, createError: Object.assign(new Error('dup'), { code: 'P2002' }) })
    await expect(runWith(tx)).resolves.toBe(false)
    expect(tx.economy.update).not.toHaveBeenCalled()
  })
})
