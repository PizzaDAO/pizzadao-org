// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({ findMany: vi.fn(), getCrewMappings: vi.fn(), usesDb: vi.fn() }))
vi.mock('@/app/lib/db', () => ({ prisma: { crewTask: { findMany: m.findMany } } }))
vi.mock('@/app/lib/crew-mappings', async () => {
  const actual = await vi.importActual<typeof import('@/app/lib/crew-mappings')>('@/app/lib/crew-mappings')
  return { ...actual, getCrewMappings: m.getCrewMappings }
})
vi.mock('@/app/lib/sheets-import/source', () => ({ usesDb: m.usesDb }))

import { myCrewTasks, openCrewTasks, taskChoice, taskPickChoices } from '../task-choices'

const task = (id: string, over: Record<string, unknown> = {}) => ({ id, crewId: 'ops', label: `Task ${id}`, stage: 'todo', priority: null, due: null, position: 1, ...over })

beforeEach(() => {
  m.findMany.mockReset().mockResolvedValue([])
  m.getCrewMappings.mockResolvedValue({
    crews: [
      { id: 'ops', label: 'Ops', turtles: [] },
      { id: 'art', label: 'Art', turtles: [] },
      { id: 'sheety', label: 'Sheety', turtles: [] },
      { id: 'general', label: 'General', turtles: [], type: 'community' },
    ],
  })
  m.usesDb.mockImplementation(async (_k: string, crewId: string) => crewId !== 'sheety')
})

describe('openCrewTasks', () => {
  it('queries unclaimed, open tasks of the database crews only', async () => {
    await openCrewTasks()
    const where = m.findMany.mock.calls[0][0].where
    expect(where.crewId).toEqual({ in: ['ops', 'art'] })
    expect(where.archived).toBe(false)
    expect(JSON.stringify(where.AND)).toContain('"leadMemberId":null')
    expect(m.findMany.mock.calls[0][0].select).toBeDefined()
  })

  it('filters to one crew, and returns nothing for a sheet crew', async () => {
    await openCrewTasks('art')
    expect(m.findMany.mock.calls[0][0].where.crewId).toEqual({ in: ['art'] })
    expect(await openCrewTasks('sheety')).toEqual([])
    expect(m.findMany).toHaveBeenCalledTimes(1)
  })

  it('sorts by priority, then due (none last), then crew, then position; drops closed stages', async () => {
    m.findMany.mockResolvedValue([
      task('low', { priority: 'Low' }),
      task('none-due', { priority: 'Top' }),
      task('soon', { priority: 'Top', due: '2026-11-01' }),
      task('later', { priority: 'Top', due: '2026-12-01' }),
      task('closed', { priority: 'Top', stage: 'Done' }),
      task('blank', { label: '  ' }),
      task('art-2', { crewId: 'art', priority: 'High', position: 2 }),
      task('art-1', { crewId: 'art', priority: 'High', position: 1 }),
    ])
    expect((await openCrewTasks()).map((t) => t.id)).toEqual(['soon', 'later', 'none-due', 'art-1', 'art-2', 'low'])
  })
})

describe('myCrewTasks', () => {
  it('asks for the member id, not archived, not closed', async () => {
    m.findMany.mockResolvedValue([task('a', { stage: 'Doing' }), task('b', { stage: 'skip' })])
    const rows = await myCrewTasks('42')
    expect(m.findMany.mock.calls[0][0].where).toMatchObject({ leadMemberId: '42', archived: false, crewId: { in: ['ops', 'art'] } })
    expect(rows.map((r) => r.id)).toEqual(['a'])
  })
})

describe('taskPickChoices', () => {
  it('claim: one capped query, id as the (string) value, "Crew · label" as the name', async () => {
    m.findMany.mockResolvedValue([task('cm1x', { label: 'Fix\nthe thing' })])
    const r = await taskPickChoices('claim', '42', '')
    expect(m.findMany.mock.calls[0][0].take).toBe(25)
    expect(r).toEqual([{ name: 'Ops · Fix the thing', value: 'cm1x' }])
  })

  it('drop: only your own tasks, and none without a member id', async () => {
    await taskPickChoices('drop', '42', '')
    expect(JSON.stringify(m.findMany.mock.calls[0][0].where.AND)).toContain('"leadMemberId":"42"')
    m.findMany.mockClear()
    expect(await taskPickChoices('drop', null, '')).toEqual([])
    expect(m.findMany).not.toHaveBeenCalled()
  })

  it('a query matches the label, case-insensitively', async () => {
    await taskPickChoices('claim', '42', 'Bake')
    expect(JSON.stringify(m.findMany.mock.calls[0][0].where.AND)).toContain('"label":{"contains":"Bake","mode":"insensitive"}')
  })
})

describe('taskChoice', () => {
  it('cuts to 100 code points without splitting an emoji', () => {
    const name = taskChoice({ id: 'x', crewId: 'ops', label: '🍕'.repeat(200) }, new Map([['ops', 'Ops']])).name
    expect(Array.from(name)).toHaveLength(100)
    expect(name).not.toMatch(/[\ud800-\udbff]$/)
  })
})
