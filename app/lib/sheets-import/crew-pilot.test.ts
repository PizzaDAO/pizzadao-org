// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/app/lib/db', () => ({ prisma: {} }))
vi.mock('@/app/api/lib/google-sheets', () => ({ getTaskLinks: vi.fn(async () => ({})), getAgendaStepLinks: vi.fn(async () => ({})) }))
vi.mock('@/app/lib/sheets/member-repository', () => ({ getSheetData: vi.fn(async () => ({ memberToIdx: new Map() })) }))
vi.mock('@/app/lib/crew-mappings', async (orig) => ({
  ...(await orig<typeof import('@/app/lib/crew-mappings')>()),
  getCrewMappings: vi.fn(async () => ({
    cached: false,
    crews: [
      { id: 'ops', label: 'Ops', turtles: [], sheet: 'https://docs.google.com/spreadsheets/d/opsSheet/edit' },
      { id: 'art', label: 'Art', turtles: [], sheet: 'https://docs.google.com/spreadsheets/d/artSheet/edit' },
    ],
  })),
}))
const fetchGviz = vi.fn(async () => ({ table: { rows: [{ c: [{ v: 'Task' }, { v: 'Stage' }] }, { c: [{ v: 'Do it' }, { v: 'todo' }] }] } }))
vi.mock('@/app/lib/sheets/gviz', () => ({ fetchGviz: (...a: unknown[]) => (fetchGviz as (...x: unknown[]) => unknown)(...a) }))
vi.mock('./source', async (orig) => ({
  ...(await orig<typeof import('./source')>()),
  getSource: vi.fn(async () => ({ kind: 'db', crews: new Set(['ops']), reason: 'setting', raw: 'db:ops' })),
}))

import { crewContentImporter } from './crew-content'

describe('crew content import during a per-crew pilot', () => {
  it('skips the crews already on the database and imports the rest', async () => {
    const { records, extra } = await crewContentImporter.load()
    expect(extra).toMatchObject({ crews: 2, skippedDbCrews: 1 })
    expect(new Set(records.map((r) => r.value.crewId))).toEqual(new Set(['art']))
    expect(fetchGviz).toHaveBeenCalledTimes(1)
    expect((fetchGviz.mock.calls[0] as unknown[])[0]).toBe('artSheet')
  })
})
