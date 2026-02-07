import { describe, it, expect, vi, beforeEach } from 'vitest'
import { completeJob } from './jobs'
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
