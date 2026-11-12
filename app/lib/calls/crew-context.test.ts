// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  usesDb: vi.fn(),
  crewContentFromDb: vi.fn(),
  getCrewMappings: vi.fn(),
  fetchOpenCrewTasksForCrew: vi.fn(),
  getCrewRoster: vi.fn(),
}))
vi.mock('@/app/lib/sheets-import/source', () => ({ usesDb: m.usesDb }))
vi.mock('@/app/lib/crew-content', () => ({ crewContentFromDb: m.crewContentFromDb }))
vi.mock('@/app/lib/crew-mappings', () => ({
  getCrewMappings: m.getCrewMappings,
  fetchOpenCrewTasksForCrew: m.fetchOpenCrewTasksForCrew,
  isClosedStage: (s: string) => /^(done|closed)$/i.test(s),
}))
vi.mock('@/app/lib/crew-leads', () => ({ getCrewRoster: m.getCrewRoster, isLeadStatus: (s: string) => /lead|capo/i.test(s) }))

import type { Settings } from '@/app/lib/settings'
import { SETTINGS, type SettingKey } from '@/app/lib/settings/registry'
import { clearCrewContextCache, CREW_CONTEXT_TTL_MS, loadCrewContext, MAX_CONTEXT_TASKS } from './crew-context'

const settings = (over: Partial<Record<SettingKey, unknown>> = {}): Settings => ({
  readFailed: false,
  invalidKeys: [],
  isSet: (k) => k in over,
  get: ((k: SettingKey) => (k in over ? over[k] : SETTINGS[k].default)) as Settings['get'],
})
const task = (label: string, stage = 'Active', lead = '') => ({ task: label, stage, url: null, lead })

beforeEach(() => {
  vi.clearAllMocks()
  clearCrewContextCache()
  m.usesDb.mockResolvedValue(true)
  m.crewContentFromDb.mockResolvedValue({ goals: [{ priority: '', description: 'Ship the map' }, { priority: '', description: ' ' }], tasks: [task('Draft'), task('Old', 'Done'), task('Review', 'Active', 'Ann')], agenda: [] })
  m.getCrewRoster.mockResolvedValue([
    { id: 'm1', status: 'Lead', name: 'Ann' },
    { id: 'm2', status: 'Member', name: 'Bob' },
    { id: '', status: 'Capo', name: 'Cy' },
  ])
})

describe('loadCrewContext', () => {
  it('database crew: goals, open tasks (closed dropped, count kept), leads and the page path', async () => {
    const c = await loadCrewContext('ops', 'Ops', settings())
    expect(c.goals).toEqual(['Ship the map'])
    expect(c.tasks.map((t) => t.label)).toEqual(['Draft', 'Review'])
    expect(c.tasks[1].lead).toBe('Ann')
    expect(c.openTaskCount).toBe(2)
    expect(c.leads).toEqual([{ name: 'Ann', memberId: 'm1' }, { name: 'Cy', memberId: null }])
    expect(c.pagePath).toBe('/crew/ops')
    expect(m.fetchOpenCrewTasksForCrew).not.toHaveBeenCalled()
  })

  it('caps the task list but reports the full open count', async () => {
    m.crewContentFromDb.mockResolvedValue({ goals: [], tasks: Array.from({ length: MAX_CONTEXT_TASKS + 4 }, (_, i) => task(`T${i}`)), agenda: [] })
    const c = await loadCrewContext('ops', 'Ops', settings())
    expect(c.tasks).toHaveLength(MAX_CONTEXT_TASKS)
    expect(c.openTaskCount).toBe(MAX_CONTEXT_TASKS + 4)
  })

  it('sheet crew: tasks from the sheet, no goals', async () => {
    m.usesDb.mockResolvedValue(false)
    m.getCrewMappings.mockResolvedValue({ crews: [{ id: 'ops', label: 'Ops', sheet: 'https://sheet' }] })
    m.fetchOpenCrewTasksForCrew.mockResolvedValue({ tasks: [{ label: 'From sheet', url: 'https://x.test', stage: 'active', isActive: true }], error: false })
    const c = await loadCrewContext('ops', 'Ops', settings())
    expect(c.goals).toEqual([])
    expect(c.tasks).toEqual([{ label: 'From sheet', url: 'https://x.test', lead: null }])
    expect(m.crewContentFromDb).not.toHaveBeenCalled()
  })

  it('a failing source leaves that part empty instead of failing', async () => {
    m.crewContentFromDb.mockRejectedValue(new Error('db'))
    m.getCrewRoster.mockRejectedValue(new Error('sheet'))
    const c = await loadCrewContext('ops', 'Ops', settings())
    expect(c).toMatchObject({ goals: [], tasks: [], leads: [], openTaskCount: 0 })
  })

  it('uses the crew link from calls.agendaLinks', async () => {
    const c = await loadCrewContext('ops', 'Ops', settings({ 'calls.agendaLinks': 'ops = Call guide | https://example.com/guide' }))
    expect(c.link).toEqual({ label: 'Call guide', url: 'https://example.com/guide' })
  })

  it('is cached per crew until the TTL passes', async () => {
    const t0 = 1_000_000
    await loadCrewContext('ops', 'Ops', settings(), t0)
    await loadCrewContext('ops', 'Ops', settings(), t0 + CREW_CONTEXT_TTL_MS - 1)
    expect(m.crewContentFromDb).toHaveBeenCalledTimes(1)
    await loadCrewContext('ops', 'Ops', settings(), t0 + CREW_CONTEXT_TTL_MS + 1)
    expect(m.crewContentFromDb).toHaveBeenCalledTimes(2)
    await loadCrewContext('latam', 'LATAM', settings(), t0 + CREW_CONTEXT_TTL_MS + 1)
    expect(m.crewContentFromDb).toHaveBeenCalledTimes(3)
  })
})
