// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

const dbMock = vi.hoisted(() => ({ prisma: {} as Record<string, unknown> }))
vi.mock('./db', () => dbMock)
vi.mock('./economy', () => ({}))
vi.mock('./settings', () => ({ loadSettings: vi.fn() }))
vi.mock('./settings/numbers', () => ({ effectiveInt: vi.fn(), envNumber: vi.fn() }))

import { assignJob, assignRandomJob, JOB_ASSIGN_LOCK_NAMESPACE } from './jobs'

const JOBS = [
  { id: 1, isActive: true },
  { id: 2, isActive: true },
  { id: 3, isActive: true },
]

/** Fake DB: transactions queue behind the advisory lock; the counter upsert is atomic. */
function fakeDb() {
  const assignments: Array<{ jobId: number; userId: string }> = []
  const locks: string[] = []
  let counter: number | null = null
  let chain: Promise<unknown> = Promise.resolve()
  const tx = {
    $executeRaw: async (_s: TemplateStringsArray, ...vals: unknown[]) => {
      locks.push(vals.join(','))
      return 1
    },
    $queryRaw: async (_s: TemplateStringsArray, first: number, n: number) => {
      counter = counter === null ? first : (counter + 1) % n
      return [{ currentIndex: counter }]
    },
    jobAssignment: {
      findFirst: async ({ where }: { where: { userId: string } }) => {
        const hit = assignments.find((a) => a.userId === where.userId) ?? null
        await new Promise((r) => setTimeout(r, 5)) // widen the check-then-insert window
        return hit
      },
      create: async ({ data }: { data: { jobId: number; userId: string } }) => {
        assignments.push(data)
        return data
      },
    },
    job: {
      findUnique: async ({ where }: { where: { id: number } }) => JOBS.find((j) => j.id === where.id) ?? null,
      findMany: async () => JOBS,
    },
  }
  Object.assign(dbMock.prisma, {
    $transaction: (fn: (t: unknown) => Promise<unknown>) => {
      const run = chain.then(() => fn(tx))
      chain = run.catch(() => undefined)
      return run
    },
  })
  return { assignments, locks }
}

describe('job assignment races', () => {
  it('assignJob: two simultaneous requests for one user, only one succeeds, under a per-user lock', async () => {
    const db = fakeDb()
    const results = await Promise.allSettled([assignJob('u1', 1), assignJob('u1', 2)])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason.message).toBe('You already have an active job')
    expect(db.assignments).toHaveLength(1)
    expect(db.locks[0]).toContain(`${JOB_ASSIGN_LOCK_NAMESPACE},u1`)
  })

  it('assignRandomJob: simultaneous requests for one user create a single assignment', async () => {
    const db = fakeDb()
    const results = await Promise.allSettled([assignRandomJob('u1'), assignRandomJob('u1'), assignRandomJob('u1')])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(db.assignments).toHaveLength(1)
  })

  it('assignRandomJob: different users racing each take a distinct round-robin slot', async () => {
    const db = fakeDb()
    const jobs = (await Promise.all(['a', 'b', 'c', 'd'].map((u) => assignRandomJob(u)))) as Array<{ id: number }>
    expect(jobs.map((j) => j.id)).toEqual([1, 2, 3, 1])
    expect(db.assignments).toHaveLength(4)
  })

  it('assignJob rejects an inactive or unknown job without writing', async () => {
    const db = fakeDb()
    await expect(assignJob('u1', 99)).rejects.toThrow('Job not found or inactive')
    expect(db.assignments).toHaveLength(0)
  })
})
