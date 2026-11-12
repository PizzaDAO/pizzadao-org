// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/db', () => ({ prisma: { crewTask: { findMany: vi.fn() } } }))
vi.mock('@/app/api/lib/google-sheets', () => ({ getTaskLinks: vi.fn(async () => ({})), getAgendaStepLinks: vi.fn(async () => ({})), getColumnHyperlinks: vi.fn(async () => ({})) }))
vi.mock('@/app/api/lib/cache', () => ({ cacheGet: vi.fn(), cacheSet: vi.fn(), cacheDel: vi.fn(), CACHE_TTL: {} }))
vi.mock('@/app/lib/sheets/member-repository', () => ({ getSheetData: vi.fn() }))

import { prisma } from '@/app/lib/db'
import { fetchCrewTasksFromDb, isActiveStage, rankCrewTasks, type RankableTask } from '@/app/lib/crew-mappings'
import { myTasksFromDb } from '@/app/lib/crew-content'
import { crewContentRecords, crewTasksEditor, openTasksInTaskSection, type TaskRecord } from './crew-content'
import { cleanRows } from './editor'
import { planUpserts } from './plan'

const r = (vals: Array<string | null>) => ({ c: vals.map((v) => (v === null ? null : { v })) })
const date = (y: number, m0: number, d: number) => ({ v: `Date(${y},${m0},${d})`, f: `${m0 + 1}/${d}/${y}` })

/** A crew sheet with an agenda, goals and tasks (synthetic). */
function crewSheet(taskRows: Array<Array<string | null | { v: string; f: string }>>) {
  return [
    r(['Call Time', 'Mondays']),
    r(['Step', 'Action', 'Lead']),
    r(['Intro', 'Say hi', 'Host']),
    r(['Review', 'Go through tasks', 'Host']),
    r([null, null, null]),
    r(['Goal', 'Priority']),
    r(['Grow the crew', 'High']),
    r([null, null]),
    r(['Task', 'Stage', 'Priority', 'Due', 'Lead', 'Lead ID']),
    ...taskRows.map((cells) => ({ c: cells.map((v) => (v === null ? null : typeof v === 'string' ? { v } : v)) })),
  ]
}

const TASKS = [
  ['Write the guide', 'todo', 'High', date(2026, 10, 5), 'A', '12'],
  ['Ship the page', 'Doing', 'Top', null, 'B', '34'],
  ['Old thing', 'Done', 'Low', null, 'A', '12'],
  ['Someday', 'later', 'Mid', null, null, null],
] as Array<Array<string | null | { v: string; f: string }>>

describe('crew content import', () => {
  it('reads tasks (done ones kept), agenda and goals with stable keys', () => {
    const { records, foundTasks } = crewContentRecords('ops', crewSheet(TASKS), {}, { Intro: 'https://example.com/intro' })
    expect(foundTasks).toBe(true)
    const tasks = records.filter((x) => x.kind === 'task') as TaskRecord[]
    expect(tasks.map((t) => [t.naturalKey, t.stage, t.leadMemberId])).toEqual([
      ['write the guide', 'todo', '12'],
      ['ship the page', 'Doing', '34'],
      ['old thing', 'Done', '12'],
      ['someday', 'later', null],
    ])
    expect(tasks[0].due).toBe('2026-11-05')
    const agenda = records.filter((x) => x.kind === 'agenda')
    expect(agenda.map((a) => a.naturalKey)).toEqual(['intro', 'review'])
    expect(agenda[0]).toMatchObject({ stepUrl: 'https://example.com/intro', leadName: 'Host' })
    expect(records.filter((x) => x.kind === 'goal').map((g) => g.naturalKey)).toEqual(['grow the crew'])
  })

  it('apply twice changes nothing; re-ordered rows keep their keys (no duplicates)', () => {
    const first = crewContentRecords('ops', crewSheet(TASKS), {}, {}).records
    const key = (x: { kind: string; crewId: string; naturalKey: string }) => `${x.kind}|${x.crewId}|${x.naturalKey}`
    const db = new Map(first.map((x) => [key(x), x]))
    expect(planUpserts(first.map((x) => ({ key: key(x), value: x })), db)).toMatchObject({ create: [], update: [], orphans: [] })
    const reordered = crewContentRecords('ops', crewSheet([TASKS[2], TASKS[0], TASKS[3], TASKS[1]]), {}, {}).records
    const plan = planUpserts(reordered.map((x) => ({ key: key(x), value: x })), db)
    expect(plan.create).toEqual([])
    expect(plan.orphans).toEqual([])
  })
})

describe('database tasks rank exactly like the sheet', () => {
  beforeEach(() => vi.mocked(prisma.crewTask.findMany).mockReset())

  it('open tasks from the DB give the same ranked list (what the agenda and crew list use)', async () => {
    const records = crewContentRecords('ops', crewSheet(TASKS), {}, {}).records.filter((x) => x.kind === 'task') as TaskRecord[]
    vi.mocked(prisma.crewTask.findMany).mockResolvedValue(records.map((t, i) => ({ ...t, id: `t${i}` })) as never)
    const fromDb = await fetchCrewTasksFromDb('ops', true)

    // The sheet path ranks the same open tasks (stage lowercase, done dropped) with rankCrewTasks.
    const sheetOpen: RankableTask[] = [
      { label: 'Write the guide', priority: 'High', stage: 'todo', isActive: true, due: '2026-11-05' },
      { label: 'Ship the page', priority: 'Top', stage: 'doing', isActive: true },
      { label: 'Someday', priority: 'Mid', stage: 'later', isActive: isActiveStage('later') },
    ]
    expect(fromDb).toEqual(rankCrewTasks(sheetOpen, true))
    expect(fromDb.tasks.map((t) => t.label)).toEqual(['Ship the page', 'Write the guide', 'Someday'])
    expect(fromDb.totalCount).toBe(3)
  })

  it('my tasks: active tasks I lead, and the tasks I closed', async () => {
    const records = crewContentRecords('ops', crewSheet(TASKS), {}, {}).records.filter((x) => x.kind === 'task') as TaskRecord[]
    vi.mocked(prisma.crewTask.findMany).mockImplementation((async (q: { where: { leadMemberId: string } }) =>
      records.filter((t) => t.leadMemberId === q?.where?.leadMemberId).map((t, i) => ({ ...t, id: `t${i}` }))) as never)
    expect(await myTasksFromDb('ops', '12')).toEqual({ active: [{ label: 'Write the guide', url: undefined }], doneCount: 1 })
    expect(await myTasksFromDb('ops', '')).toEqual({ active: [], doneCount: 0 })
  })
})

describe('blank stage', () => {
  const BLANK = [
    ['No stage yet', null, 'Top', null, null, null],
    ['Planned', 'todo', 'Low', null, null, null],
  ] as Array<Array<string | null | { v: string; f: string }>>

  it('imports a blank stage as blank (not todo), so it ranks where the sheet ranks it', async () => {
    const records = crewContentRecords('ops', crewSheet(BLANK), {}, {}).records.filter((x) => x.kind === 'task') as TaskRecord[]
    expect(records.map((t) => t.stage)).toEqual(['', 'todo'])
    vi.mocked(prisma.crewTask.findMany).mockResolvedValue(records.map((t, i) => ({ ...t, id: `t${i}` })) as never)
    const fromDb = await fetchCrewTasksFromDb('ops', true)
    // The sheet path: a blank stage is open but not active, so an active Low task ranks above a blank Top one.
    const sheetOpen: RankableTask[] = [
      { label: 'No stage yet', priority: 'Top', stage: '', isActive: false },
      { label: 'Planned', priority: 'Low', stage: 'todo', isActive: true },
    ]
    expect(fromDb).toEqual(rankCrewTasks(sheetOpen, true))
    expect(fromDb.all?.map((t) => t.label)).toEqual(['Planned', 'No stage yet'])
  })

  it('the task editor keeps a blank stage blank', async () => {
    const tx = vi.fn(async () => [])
    const create = vi.fn((a: unknown) => a)
    const db = prisma as unknown as Record<string, unknown>
    db.$transaction = tx
    db.crewTask = { findMany: vi.fn(async () => []), create, update: vi.fn() }
    db.crewTaskEvent = { create: vi.fn() }
    const spec = crewTasksEditor('ops')
    await spec.save(cleanRows(spec, [{ task: 'No stage yet' }, { task: 'Planned', stage: 'todo' }]), 'tester')
    expect(create.mock.calls.map((c) => (c[0] as { data: { stage: string } }).data.stage)).toEqual(['', 'todo'])
    db.crewTask = { findMany: vi.fn() }
  })
})

describe('task editor history events', () => {
  const prev = (id: string, position: number, over: Record<string, unknown> = {}) => ({
    id, crewId: 'ops', naturalKey: id, label: `Task ${id}`, url: null, stage: 'todo', priority: null, due: null, dueRaw: null,
    leadName: null, leadMemberId: null, goal: null, notes: null, position, doneAt: null, archived: false, updatedAt: new Date(0), createdAt: new Date(0), ...over,
  })
  const setup = (existing: unknown[]) => {
    const eventCreate = vi.fn((a: unknown) => a)
    const db = prisma as unknown as Record<string, unknown>
    db.$transaction = vi.fn(async () => [])
    db.crewTask = { findMany: vi.fn(async () => existing), create: vi.fn((a: unknown) => a), update: vi.fn((a: unknown) => a) }
    db.crewTaskEvent = { create: eventCreate }
    return { eventCreate, db }
  }
  const row = (id: string, over: Record<string, string> = {}) => ({ id, rev: new Date(0).toISOString(), task: `Task ${id}`, stage: 'todo', ...over })
  const events = (f: ReturnType<typeof vi.fn>) => f.mock.calls.map((c) => (c[0] as { data: { action: string; taskId: string; data: unknown } }).data)

  it('logs only the fields that differ, as { changes }', async () => {
    const { eventCreate } = setup([prev('a', 0)])
    const spec = crewTasksEditor('ops')
    await spec.save(cleanRows(spec, [row('a', { stage: 'Doing', lead: 'Sal', leadId: '5' })]), 'tester')
    const ev = events(eventCreate)
    expect(ev).toHaveLength(1)
    expect(ev[0]).toMatchObject({ action: 'update', taskId: 'a', data: { changes: { stage: 'Doing', leadName: 'Sal', leadMemberId: '5' } } })
  })

  it('a pure position shift updates the row but logs no event', async () => {
    const { eventCreate, db } = setup([prev('a', 0), prev('b', 1)])
    const spec = crewTasksEditor('ops')
    await spec.save(cleanRows(spec, [row('b'), row('a')]), 'tester')
    expect((db.crewTask as { update: ReturnType<typeof vi.fn> }).update).toHaveBeenCalledTimes(2)
    expect(eventCreate).not.toHaveBeenCalled()
  })

  it('logs a create event naming the new row', async () => {
    const { eventCreate, db } = setup([])
    const spec = crewTasksEditor('ops')
    await spec.save(cleanRows(spec, [{ task: 'Brand new', stage: 'todo' }]), 'tester')
    const created = ((db.crewTask as { create: ReturnType<typeof vi.fn> }).create.mock.calls[0][0] as { data: { id: string } }).data.id
    expect(created).toBeTruthy()
    expect(events(eventCreate)).toEqual([expect.objectContaining({ action: 'create', taskId: created, data: { label: 'Brand new' } })])
  })
})

describe('parity: sheet ranking rows outside the task section', () => {
  it('drops ranked rows that are not tasks of the task section, keeping the rest in order', () => {
    const ranked = [{ label: 'A  task' }, { label: 'Goal' }, { label: 'B' }, { label: 'Issue' }, { label: 'B' }]
    const { kept, outside } = openTasksInTaskSection(ranked, [{ task: 'A task' }, { task: 'B' }])
    expect(kept.map((t) => t.label)).toEqual(['A  task', 'B'])
    expect(outside).toBe(3)
  })
})

describe('crew task editor', () => {
  it('validates dates, links and lead ids', () => {
    const spec = crewTasksEditor('ops')
    expect(() => cleanRows(spec, [{ task: 'A', due: 'tomorrow' }])).toThrow(/YYYY-MM-DD/)
    expect(() => cleanRows(spec, [{ task: 'A', leadId: 'someone' }])).toThrow(/member id/)
    expect(() => cleanRows(spec, [{ task: 'A', url: 'ftp://x' }])).toThrow(/link/)
    const rows = cleanRows(spec, [{ id: 'abc', task: 'A', due: '2026-12-01' }, { task: 'A' }])
    expect(rows[0]).toMatchObject({ id: 'abc', task: 'A', due: '2026-12-01' })
    expect(rows).toHaveLength(2) // same label twice is fine: rows are matched by id
  })
})
