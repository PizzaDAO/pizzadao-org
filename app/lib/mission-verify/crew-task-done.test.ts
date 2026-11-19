// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./engine', () => ({ runVerifiers: vi.fn(async () => ({ approved: [], levelsPaid: [], checks: [] })) }))
vi.mock('./notify', () => ({ announceMissionResults: vi.fn(async () => undefined) }))
vi.mock('../rare-pizza-box', () => ({ clearBoxCache: vi.fn(async () => undefined) }))
vi.mock('../sheets/member-repository', () => ({ fetchMemberIdByDiscordId: vi.fn(async () => null) }))
vi.mock('./policy', () => ({ missionVerifiersEnabled: vi.fn(() => true) }))
vi.mock('../db', () => ({
  prisma: {
    crewTask: { findMany: vi.fn() },
    crewTaskEvent: { findMany: vi.fn() },
    member: { findMany: vi.fn() },
  },
}))
vi.mock('next/server', () => ({ after: (fn: () => unknown) => void fn() }))

import { prisma } from '../db'
import { runVerifiers } from './engine'
import { emitMissionEvent } from './events'
import { VERIFIERS } from './verifiers'
import { closedNow, emitCrewTaskDone } from './crew-task-event'
import { doneCrewTasksLedBy, isDoneStage } from './sources'
import type { VerifierSources, VerifyCtx } from './types'

const db = prisma as unknown as {
  crewTask: { findMany: ReturnType<typeof vi.fn> }
  crewTaskEvent: { findMany: ReturnType<typeof vi.fn> }
  member: { findMany: ReturnType<typeof vi.fn> }
}

beforeEach(() => vi.clearAllMocks())

describe('crew_task_done verifier: yes/no matrix', () => {
  const v = VERIFIERS.crew_task_done
  // Roles: "lead-ops" leads crew ops, "lead-ev" leads crew events, "admin" is an admin; the member is "me".
  const canClose = async (id: string, crew: string) => (id === 'lead-ops' && crew === 'ops') || (id === 'lead-ev' && crew === 'events') || id === 'admin'
  const run = (tasks: Array<{ crewId: string; closedBy: string | null }>, over: Partial<VerifierSources> = {}, memberId: string | null = 'm1') => {
    const ctx: VerifyCtx = {
      discordId: 'me', memberId, trigger: 'event', now: new Date(), evidence: null, memo: new Map(),
      sources: { getDoneCrewTasksLedBy: async () => tasks.map((t, i) => ({ taskId: `t${i}`, label: `T${i}`, ...t })), canCloseCrewTasks: canClose, ...over } as VerifierSources,
    }
    return v.check(ctx, { min: 1 })
  }

  it('member leads the task and a lead of its crew closed it: yes', async () => {
    expect(await run([{ crewId: 'ops', closedBy: 'lead-ops' }])).toMatchObject({ status: 'pass' })
  })
  it('task in another crew whose own lead closed it: yes', async () => {
    expect(await run([{ crewId: 'events', closedBy: 'lead-ev' }])).toMatchObject({ status: 'pass' })
  })
  it('closed by an admin: yes', async () => {
    expect(await run([{ crewId: 'ops', closedBy: 'admin' }])).toMatchObject({ status: 'pass' })
  })
  it('closed by the member themself: no', async () => {
    expect(await run([{ crewId: 'ops', closedBy: 'me' }])).toMatchObject({ status: 'fail' })
  })
  it('closed by a non-lead member: no', async () => {
    expect(await run([{ crewId: 'ops', closedBy: 'someone' }])).toMatchObject({ status: 'fail' })
  })
  it('closed by the lead of a different crew: no', async () => {
    expect(await run([{ crewId: 'events', closedBy: 'lead-ops' }])).toMatchObject({ status: 'fail' })
  })
  it('no recorded closer: no', async () => {
    expect(await run([{ crewId: 'ops', closedBy: null }])).toMatchObject({ status: 'fail' })
  })
  it('member leads no Done task (not a lead of anything): no', async () => {
    expect(await run([])).toMatchObject({ status: 'fail' })
    expect(await run([], {}, null)).toMatchObject({ status: 'fail' })
  })
  it('one qualifying task is enough', async () => {
    expect(await run([{ crewId: 'ops', closedBy: 'me' }, { crewId: 'ops', closedBy: 'lead-ops' }])).toMatchObject({ status: 'pass' })
  })
  it('lookup errors are unknown, never a fail', async () => {
    expect(await run([{ crewId: 'ops', closedBy: 'lead-ops' }], { canCloseCrewTasks: async () => { throw new Error('x') } })).toMatchObject({ status: 'unknown' })
    expect(await run([], { getDoneCrewTasksLedBy: async () => { throw new Error('x') } })).toMatchObject({ status: 'unknown' })
    expect(await run([], { getDoneCrewTasksLedBy: undefined })).toMatchObject({ status: 'unknown' })
  })
})

describe('who moved the task to Done (doneCrewTasksLedBy)', () => {
  it('uses the latest update event that set a Done stage; ignores other changes, and open or skipped tasks', async () => {
    db.crewTask.findMany.mockResolvedValue([
      { id: 'a', crewId: 'ops', label: 'A', stage: 'Done' },
      { id: 'b', crewId: 'ops', label: 'B', stage: 'doing' },
      { id: 'c', crewId: 'ops', label: 'C', stage: 'skip' },
      { id: 'd', crewId: 'ops', label: 'D', stage: 'done' },
    ])
    // newest first, as queried
    db.crewTaskEvent.findMany.mockResolvedValue([
      { taskId: 'a', actor: 'editor-2', data: { changes: { notes: 'tidy' } } },
      { taskId: 'a', actor: 'lead-ops', data: { changes: { stage: 'Done' } } },
      { taskId: 'a', actor: 'me', data: { changes: { stage: 'doing' } } },
    ])
    expect(await doneCrewTasksLedBy('m1')).toEqual([
      { taskId: 'a', crewId: 'ops', label: 'A', closedBy: 'lead-ops' },
      { taskId: 'd', crewId: 'ops', label: 'D', closedBy: null },
    ])
    expect(db.crewTask.findMany.mock.calls[0][0].where).toMatchObject({ leadMemberId: 'm1', archived: false })
  })
  it('isDoneStage: done and complete, not skip', () => {
    expect([' Done ', 'complete', 'Completed'].every(isDoneStage)).toBe(true)
    expect(['skip', 'doing', '', null].some((s) => isDoneStage(s))).toBe(false)
  })
})

describe('emission when a task moves to Done', () => {
  it('closedNow: only a change into a closed stage', () => {
    expect(closedNow('doing', 'Done')).toBe(true)
    expect(closedNow(null, 'done')).toBe(true)
    expect(closedNow('done', 'done')).toBe(false)
    expect(closedNow('doing', 'todo')).toBe(false)
  })
  it('emits crew_task_done for the lead of each task, with their member id', async () => {
    db.crewTask.findMany.mockResolvedValue([{ leadMemberId: 'm1' }, { leadMemberId: 'm1' }, { leadMemberId: null }])
    db.member.findMany.mockResolvedValue([{ id: 'm1', discordId: 'd-m1' }])
    await emitCrewTaskDone(['a', 'b', 'c'])
    expect(runVerifiers).toHaveBeenCalledTimes(1)
    expect(runVerifiers).toHaveBeenCalledWith('d-m1', { trigger: 'event', verifierKeys: ['crew_task_done'], memberId: 'm1' })
  })
  it('does nothing without tasks or a lead, and never throws', async () => {
    await emitCrewTaskDone([])
    db.crewTask.findMany.mockResolvedValue([{ leadMemberId: null }])
    await emitCrewTaskDone(['a'])
    db.crewTask.findMany.mockRejectedValue(new Error('db'))
    await expect(emitCrewTaskDone(['a'])).resolves.toBeUndefined()
    expect(runVerifiers).not.toHaveBeenCalled()
  })
  it('the event re-runs only the crew_task_done mission', async () => {
    await emitMissionEvent('d1', 'crew_task_done', { memberId: 'm1' })
    expect(runVerifiers).toHaveBeenCalledWith('d1', { trigger: 'event', verifierKeys: ['crew_task_done'], memberId: 'm1' })
  })
})
