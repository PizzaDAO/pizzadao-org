// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/db', () => ({
  prisma: { crewTask: { updateMany: vi.fn(async () => ({ count: 1 })), findMany: vi.fn(async () => []), create: vi.fn(), update: vi.fn((a: unknown) => a) }, crewTaskEvent: { create: vi.fn((a: unknown) => a) }, $transaction: vi.fn(async () => []) },
}))
vi.mock('@/app/lib/crew-mappings', () => ({
  invalidateCrewMappingsCache: vi.fn(async () => undefined),
  isClosedStage: (s: string) => ['done', 'skip', 'skipped', 'complete', 'completed'].includes(s.trim().toLowerCase()),
}))
vi.mock('@/app/lib/mission-verify/crew-task-event', () => ({ emitCrewTaskDoneLater: vi.fn() }))

import { prisma } from '@/app/lib/db'
import { emitCrewTaskDoneLater } from '@/app/lib/mission-verify/crew-task-event'
import { updateCrewTask } from './crew-tasks-write'

beforeEach(() => vi.clearAllMocks())

describe('updateCrewTask: mission event on Done', () => {
  const upd = (patch: Record<string, unknown>, prevStage: string) => updateCrewTask('ops', 't1', patch, 'actor-1', { expectUpdatedAt: null, prev: { stage: prevStage } })

  it('emits when the task moves to Done', async () => {
    expect(await upd({ stage: 'Done' }, 'doing')).toBe(true)
    expect(emitCrewTaskDoneLater).toHaveBeenCalledWith(['t1'])
  })
  it('does not emit for other stage changes, edits without a stage, or an already closed task', async () => {
    await upd({ stage: 'doing' }, 'todo')
    await upd({ notes: 'x' }, 'doing')
    await upd({ stage: 'done' }, 'done')
    expect(emitCrewTaskDoneLater).not.toHaveBeenCalled()
  })
  it('does not emit when the write lost a race', async () => {
    ;(prisma.crewTask.updateMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ count: 0 })
    expect(await upd({ stage: 'Done' }, 'doing')).toBe(false)
    expect(emitCrewTaskDoneLater).not.toHaveBeenCalled()
  })
})
