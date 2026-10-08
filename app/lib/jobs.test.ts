import { describe, it, expect, vi, beforeEach } from 'vitest'
import { completeJob, recordDailyJobCompletion, isTodaysDailyJob } from './jobs'
import { prisma } from './db'

vi.mock('./db')
vi.mock('./economy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./economy')>()),
  getOrCreateEconomy: vi.fn().mockResolvedValue({}),
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

import { logTransaction } from './transactions'

const mockFn = (f: unknown) => f as ReturnType<typeof vi.fn>

describe('completeJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFn(prisma.$transaction).mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma))
    mockFn(prisma.economy.update).mockResolvedValue({})
  })

  const ASSIGNMENT = {
    id: 1,
    jobId: 7,
    userId: 'worker-1',
    job: { id: 7, description: 'Clean the kitchen', type: 'General', isActive: true },
  }

  it('removes the assignment, pays and logs JOB_REWARD (with the granting admin) in one transaction', async () => {
    mockFn(prisma.jobAssignment.findFirst).mockResolvedValue(ASSIGNMENT)
    mockFn(prisma.jobAssignment.deleteMany).mockResolvedValue({ count: 1 })

    const result = await completeJob('worker-1', 50, 'admin-1')

    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(prisma.jobAssignment.deleteMany).toHaveBeenCalledWith({ where: { id: 1 } })
    expect(prisma.economy.update).toHaveBeenCalledWith({ where: { id: 'worker-1' }, data: { wallet: { increment: 50 } } })
    expect(logTransaction).toHaveBeenCalledWith(
      prisma,
      'worker-1',
      'JOB_REWARD',
      50,
      'Job reward: Clean the kitchen',
      { jobId: 7, grantedBy: 'admin-1' }
    )
    expect(result).toEqual({
      success: true,
      job: expect.objectContaining({ id: 7, description: 'Clean the kitchen' }),
      reward: 50,
    })
  })

  it('resolves Discord markup in the job description to plain text in the ledger memo', async () => {
    mockFn(prisma.jobAssignment.findFirst).mockResolvedValue({
      ...ASSIGNMENT,
      id: 3,
      job: { id: 7, description: 'Clean <#123456789012345678> now', type: 'General', isActive: true },
    })
    mockFn(prisma.jobAssignment.deleteMany).mockResolvedValue({ count: 1 })

    await completeJob('worker-1', 50)

    // No Discord bot token configured in tests, so the mention can't be
    // resolved to a real name — it falls back to "#channel" instead of
    // leaking the raw <#id> markup into the ledger.
    expect(logTransaction).toHaveBeenCalledWith(
      prisma,
      'worker-1',
      'JOB_REWARD',
      50,
      'Job reward: Clean #channel now',
      { jobId: 7 },
    )
  })

  it('keeps a <t:...> tag raw in the memo instead of formatting it at write time', async () => {
    mockFn(prisma.jobAssignment.findFirst).mockResolvedValue({
      ...ASSIGNMENT,
      id: 4,
      job: { id: 7, description: 'Due <t:1700000000:R>', type: 'General', isActive: true },
    })
    mockFn(prisma.jobAssignment.deleteMany).mockResolvedValue({ count: 1 })

    await completeJob('worker-1', 50)

    expect(logTransaction).toHaveBeenCalledWith(
      prisma,
      'worker-1',
      'JOB_REWARD',
      50,
      'Job reward: Due <t:1700000000:R>',
      { jobId: 7 },
    )
  })

  it('never throws building the memo for an out-of-range timestamp in the job description', async () => {
    mockFn(prisma.jobAssignment.findFirst).mockResolvedValue({
      ...ASSIGNMENT,
      id: 5,
      job: { id: 7, description: 'Due <t:9999999999999>', type: 'General', isActive: true },
    })
    mockFn(prisma.jobAssignment.deleteMany).mockResolvedValue({ count: 1 })

    await expect(completeJob('worker-1', 50)).resolves.toEqual(
      expect.objectContaining({ success: true }),
    )
    expect(logTransaction).toHaveBeenCalledWith(
      prisma,
      'worker-1',
      'JOB_REWARD',
      50,
      'Job reward: Due ',
      { jobId: 7 },
    )
  })

  it('does not pay when a concurrent completion already removed the assignment', async () => {
    mockFn(prisma.jobAssignment.findFirst).mockResolvedValue(ASSIGNMENT)
    mockFn(prisma.jobAssignment.deleteMany).mockResolvedValue({ count: 0 })

    await expect(completeJob('worker-1', 50)).rejects.toThrow('User does not have an active job')
    expect(prisma.economy.update).not.toHaveBeenCalled()
    expect(logTransaction).not.toHaveBeenCalled()
  })

  it('should not log transaction when reward is zero', async () => {
    mockFn(prisma.jobAssignment.findFirst).mockResolvedValue({ ...ASSIGNMENT, id: 2 })
    mockFn(prisma.jobAssignment.deleteMany).mockResolvedValue({ count: 1 })

    await completeJob('worker-1', 0)

    expect(prisma.economy.update).not.toHaveBeenCalled()
    expect(logTransaction).not.toHaveBeenCalled()
  })

  it('should throw when user has no active job', async () => {
    mockFn(prisma.jobAssignment.findFirst).mockResolvedValue(null)
    await expect(completeJob('worker-1', 50)).rejects.toThrow('User does not have an active job')
  })
})

describe('isTodaysDailyJob', () => {
  it("only accepts the jobs on today's board", async () => {
    const jobs = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, description: `job ${i + 1}`, type: 't', assignments: [] }))
    mockFn(prisma.job.findMany).mockResolvedValue(jobs)
    const results = await Promise.all(jobs.map((j) => isTodaysDailyJob(j.id)))
    expect(results.filter(Boolean)).toHaveLength(3)
    expect(await isTodaysDailyJob(999)).toBe(false)
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
