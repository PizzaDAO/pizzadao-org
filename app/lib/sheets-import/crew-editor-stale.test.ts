// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/lib/db')
vi.mock('@/app/api/lib/google-sheets', () => ({ getTaskLinks: vi.fn(), getAgendaStepLinks: vi.fn(), getColumnHyperlinks: vi.fn() }))
vi.mock('@/app/api/lib/cache', () => ({ cacheGet: vi.fn(), cacheSet: vi.fn(), cacheDel: vi.fn(), CACHE_TTL: {} }))
vi.mock('@/app/lib/sheets/member-repository', () => ({ getSheetData: vi.fn() }))
vi.mock('@/app/lib/crew-mappings', async (orig) => ({ ...(await orig<typeof import('@/app/lib/crew-mappings')>()), invalidateCrewMappingsCache: vi.fn(async () => {}) }))

import { prisma } from '@/app/lib/db'
import { crewTasksEditor } from './crew-content'
import { EditorConflict } from './editor'

const task = vi.mocked(prisma.crewTask)
const LOADED = new Date('2026-11-01T10:00:00Z')
const t = (over: Record<string, unknown> = {}) => ({
  id: 't1', crewId: 'ops', naturalKey: 'a', label: 'A', url: null, stage: 'todo', priority: null, goal: null, due: null, dueRaw: null, leadName: null, leadMemberId: null,
  notes: null, position: 0, doneAt: null, archived: false, createdAt: new Date('2026-10-01'), updatedAt: LOADED, ...over,
})
const editRow = (over: Record<string, unknown> = {}) => ({ id: 't1', rev: LOADED.toISOString(), task: 'A', url: '', stage: 'doing', priority: '', due: '', lead: '', leadId: '', goal: '', notes: '', ...over })

beforeEach(() => {
  vi.clearAllMocks()
  task.update.mockResolvedValue({} as never)
  task.create.mockResolvedValue({} as never)
  vi.mocked(prisma.crewTaskEvent.create).mockResolvedValue({} as never)
})

describe('crew tasks editor: stale pages', () => {
  it('list carries a revision per row', async () => {
    task.findMany.mockResolvedValue([t()] as never)
    expect((await crewTasksEditor('ops').list())[0].rev).toBe(LOADED.toISOString())
  })

  it('saves normally when the task is unchanged since the page loaded', async () => {
    task.findMany.mockResolvedValue([t()] as never)
    const counts = await crewTasksEditor('ops').save([editRow()], 'lead1')
    expect(counts.updated).toBe(1)
    expect(task.update).toHaveBeenCalled()
  })

  it('two consecutive saves from one editor succeed once it takes the fresh rows; a save from stale rows still conflicts', async () => {
    const spec = crewTasksEditor('ops')
    task.findMany.mockResolvedValue([t()] as never)
    const first = await spec.list()
    await spec.save([{ ...first[0], stage: 'doing' }], 'lead1') // bumps updatedAt
    const bumped = new Date('2026-11-01T10:05:00Z')
    task.findMany.mockResolvedValue([t({ stage: 'doing', updatedAt: bumped })] as never)
    const second = await spec.list() // what the editor reloads after a save
    expect(second[0].rev).toBe(bumped.toISOString())
    await expect(spec.save([{ ...second[0], stage: 'now' }], 'lead1')).resolves.toMatchObject({ updated: 1 })
    // Another editor changed the row meanwhile: the first editor's (now old) rev conflicts.
    await expect(spec.save([{ ...first[0], stage: 'done' }], 'lead1')).rejects.toBeInstanceOf(EditorConflict)
  })

  it('refuses to overwrite a task that changed since the page loaded, and writes nothing', async () => {
    task.findMany.mockResolvedValue([t({ updatedAt: new Date('2026-11-01T11:00:00Z'), stage: 'done' })] as never)
    await expect(crewTasksEditor('ops').save([editRow()], 'lead1')).rejects.toBeInstanceOf(EditorConflict)
    await expect(crewTasksEditor('ops').save([editRow()], 'lead1')).rejects.toThrow(/reload/i)
    expect(task.update).not.toHaveBeenCalled()
    expect(task.create).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('never un-archives a task from a stale page row', async () => {
    task.findMany.mockResolvedValue([t({ archived: true })] as never)
    await expect(crewTasksEditor('ops').save([editRow({ rev: '' })], 'lead1')).rejects.toBeInstanceOf(EditorConflict)
    expect(task.update).not.toHaveBeenCalled()
  })

  it('does not remove a task the page never saw (created after it loaded)', async () => {
    task.findMany.mockResolvedValue([t(), t({ id: 't2', naturalKey: 'b', label: 'Created by an applied proposal', createdAt: new Date('2026-11-01T10:30:00Z') })] as never)
    const counts = await crewTasksEditor('ops').save([editRow()], 'lead1', { loadedAt: LOADED })
    expect(counts.deactivated).toBe(0)
    expect(task.update.mock.calls.every((c) => (c[0] as { where: { id: string } }).where.id !== 't2')).toBe(true)
  })

  it('still removes a task the page did see and the user deleted', async () => {
    task.findMany.mockResolvedValue([t(), t({ id: 't2', naturalKey: 'b', label: 'B', createdAt: new Date('2026-10-02') })] as never)
    const counts = await crewTasksEditor('ops').save([editRow()], 'lead1', { loadedAt: LOADED })
    expect(counts.deactivated).toBe(1)
  })
})
