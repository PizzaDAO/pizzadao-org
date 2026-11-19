// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/db', () => ({ prisma: { crewTask: { findMany: vi.fn() }, crewTaskEvent: { create: vi.fn((a: unknown) => a) }, $transaction: vi.fn(async () => []) } }))
vi.mock('@/app/api/lib/google-sheets', () => ({ getTaskLinks: vi.fn(async () => ({})), getAgendaStepLinks: vi.fn(async () => ({})), getColumnHyperlinks: vi.fn(async () => ({})) }))
vi.mock('@/app/api/lib/cache', () => ({ cacheGet: vi.fn(), cacheSet: vi.fn(), cacheDel: vi.fn(), CACHE_TTL: {} }))
vi.mock('@/app/lib/sheets/member-repository', () => ({ getSheetData: vi.fn() }))
vi.mock('@/app/lib/mission-verify/crew-task-event', () => ({ emitCrewTaskDoneLater: vi.fn() }))

import { prisma } from '@/app/lib/db'
import { emitCrewTaskDoneLater } from '@/app/lib/mission-verify/crew-task-event'
import { crewTasksEditor } from './crew-content'
import { cleanRows } from './editor'

const existing = (id: string, stage: string) => ({
  id, crewId: 'ops', naturalKey: id, label: `Task ${id}`, url: null, stage, priority: null, due: null, dueRaw: null,
  leadName: null, leadMemberId: null, goal: null, notes: null, position: 0, doneAt: null, archived: false, updatedAt: new Date(0), createdAt: new Date(0),
})

beforeEach(() => {
  vi.clearAllMocks()
  const db = prisma as unknown as Record<string, unknown>
  db.crewTask = { findMany: vi.fn(async () => [existing('a', 'doing'), existing('b', 'done')]), create: vi.fn((a: unknown) => a), update: vi.fn((a: unknown) => a) }
})

describe('crew page task editor: mission event on Done', () => {
  const save = (rows: Array<Record<string, string>>) => {
    const spec = crewTasksEditor('ops')
    return spec.save(cleanRows(spec, rows.map((r) => ({ rev: new Date(0).toISOString(), ...r }))), 'lead-1')
  }

  it('emits for a task moved to Done, not for one that was already Done', async () => {
    await save([{ id: 'a', task: 'Task a', stage: 'Done' }, { id: 'b', task: 'Task b', stage: 'done', notes: 'edited' }])
    expect(emitCrewTaskDoneLater).toHaveBeenCalledWith(['a'])
  })
  it('does not emit when nothing moved to Done', async () => {
    await save([{ id: 'a', task: 'Task a', stage: 'todo' }, { id: 'b', task: 'Task b', stage: 'done' }])
    expect(emitCrewTaskDoneLater).not.toHaveBeenCalled()
  })
})
