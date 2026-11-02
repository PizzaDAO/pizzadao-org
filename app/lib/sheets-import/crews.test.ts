// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/app/lib/db', () => ({ prisma: {} }))
vi.mock('@/app/api/lib/google-sheets', () => ({ getManualLinks: vi.fn(), getTaskLinks: vi.fn(async () => ({})), getColumnHyperlinks: vi.fn(async () => ({})) }))
vi.mock('@/app/api/lib/cache', () => ({ cacheGet: vi.fn(), cacheSet: vi.fn(), cacheDel: vi.fn(), CACHE_TTL: {} }))

import type { GvizResponse } from '@/app/lib/gviz-parser'
import { crewRowToOption, parseCrewMappings } from '@/app/lib/crew-mappings'
import { crewRecords, crewsEditor, crewSlug } from './crews'
import { cleanRows } from './editor'
import { planUpserts } from './plan'

const row = (vals: Array<string | null>) => ({ c: vals.map((v) => (v === null ? null : { v })) })
const sheet = (rows: Array<Array<string | null>>): GvizResponse =>
  ({
    table: {
      cols: ['Crew', 'Turtles', 'Role', 'Channel', 'Event', 'Emoji', 'Sheet', 'Call Time', 'Call Length', 'Type', 'Script'].map((label) => ({ label })),
      rows: rows.map(row),
    },
  }) as unknown as GvizResponse

const FIXTURE = sheet([
  ['Ops', 'Leonardo, Raphael', 'role-1', 'ops-chan', 'Ops Call', '🍕', 'https://docs.google.com/spreadsheets/d/abc/edit', 'Mon 3pm', '1h', 'core', 'yes'],
  ['Ops', 'Donatello', null, null, null, null, null, null, null, null, null],
  ['Art & Design', null, null, 'art', 'Art Call', '🎨', null, 'Tue', null, null, null],
  [null, 'orphan', null, null, null, null, null, null, null, null, null],
])

describe('crew registry', () => {
  it('parses and merges duplicate rows as before', () => {
    const { crews, extras } = parseCrewMappings(FIXTURE)
    expect(crews.map((c) => c.id)).toEqual(['art_design', 'ops'])
    const ops = crews.find((c) => c.id === 'ops')!
    expect(ops.turtles).toEqual(['Leonardo', 'Raphael', 'Donatello'])
    expect(extras.get('ops')).toEqual({ type: 'core', script: 'yes' })
  })

  it('a DB row built from the import gives back exactly the crew the sheet path shows', () => {
    const { crews, extras } = parseCrewMappings(FIXTURE)
    crews[1].callTimeUrl = 'https://calendar.example/ops'
    for (const rec of crewRecords(crews, extras)) {
      const fromDb = crewRowToOption({ id: rec.key, ...rec.value })
      const fromSheet = crews.find((c) => c.id === rec.key)!
      expect(fromDb).toEqual(fromSheet)
    }
  })

  it('import is idempotent', () => {
    const { crews, extras } = parseCrewMappings(FIXTURE)
    const recs = crewRecords(crews, extras)
    const db = new Map(recs.map((r) => [r.key, r.value]))
    expect(planUpserts(crewRecords(crews, extras), db)).toMatchObject({ create: [], update: [], unchanged: 2, orphans: [] })
  })

  it('editor keys crews by the same slug and rejects bad links', () => {
    expect(crewSlug('Art & Design')).toBe('art_design')
    expect(cleanRows(crewsEditor, [{ label: 'Ops', turtles: 'A, B' }])).toHaveLength(1)
    expect(() => cleanRows(crewsEditor, [{ label: 'Ops', callTimeUrl: 'nope' }])).toThrow(/call link/)
    expect(() => cleanRows(crewsEditor, [{ label: 'Ops' }, { label: 'ops' }])).toThrow(/duplicate/)
  })
})
