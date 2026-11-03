// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/db', () => ({ prisma: {} }))
vi.mock('@/app/api/lib/google-sheets', () => ({ getTaskLinks: vi.fn(async () => ({})), getAgendaStepLinks: vi.fn(async () => ({})), getColumnHyperlinks: vi.fn(async () => ({})) }))
vi.mock('@/app/api/lib/cache', () => ({ cacheGet: vi.fn(), cacheSet: vi.fn(), cacheDel: vi.fn(), CACHE_TTL: {} }))
vi.mock('@/app/lib/sheets/member-repository', () => ({ getSheetData: vi.fn() }))
vi.mock('@/app/lib/crew-mappings', async (orig) => ({ ...(await orig<typeof import('@/app/lib/crew-mappings')>()), getCrewMappings: vi.fn() }))
vi.mock('@/app/lib/crew-sheet', async (orig) => ({ ...(await orig<typeof import('@/app/lib/crew-sheet')>()), fetchCrewRoster: vi.fn() }))
vi.mock('@/app/lib/crew-roles', async (orig) => ({ ...(await orig<typeof import('@/app/lib/crew-roles')>()), crewRolesFromDb: vi.fn(), loadCrewRosterFromDb: vi.fn() }))
vi.mock('@/app/lib/member-utils', () => ({ findMemberIdByDiscordId: vi.fn() }))

import { getCrewMappings } from '@/app/lib/crew-mappings'
import { fetchCrewRoster, parseCrewSheetRows, type RosterRow } from '@/app/lib/crew-sheet'
import { crewRolesFromDb, loadCrewRosterFromDb, toRosterRow } from '@/app/lib/crew-roles'
import { findMemberIdByDiscordId } from '@/app/lib/member-utils'
import { getCrewLeadMemberIds, isCrewLead, isOnCrewRoster } from '@/app/lib/crew-leads'
import { crewRosterEditor, rosterRecords } from './crew-roles'
import { cleanRows } from './editor'
import { planUpserts } from './plan'

const r = (vals: Array<string | null>) => ({ c: vals.map((v) => (v === null ? null : { v })) })
const SHEET = [
  r(['ID', 'Name', 'Status', 'City']),
  r(['1', 'Alpha', 'Lead', 'Rome']),
  r(['2', 'Beta', 'Active', 'Lima']),
  r([null, 'Gamma', 'Capo', 'Oslo']),
  r(['4', 'Delta', 'Former lead', '']),
  r(['1', 'Alpha again', 'Active', '']),
]

describe('roster import', () => {
  it('keys rows by member id (or name), keeps leads without ids visible, keeps (and reports) repeated ids', () => {
    const { roster } = parseCrewSheetRows(SHEET as never[])
    const { records, duplicates } = rosterRecords('ops', roster)
    expect(records.map((x) => x.naturalKey)).toEqual(['id:1', 'id:2', 'name:gamma', 'id:4', 'id:1#2'])
    expect(duplicates).toEqual([5])
    // Every row the crew page shows is kept, in order.
    expect(records.map(toRosterRow)).toEqual(roster)
    expect(records.map((x) => x.position)).toEqual([0, 1, 2, 3, 4])
    const db = new Map(records.map((x) => [`${x.crewId}|${x.naturalKey}`, x]))
    expect(planUpserts(records.map((x) => ({ key: `${x.crewId}|${x.naturalKey}`, value: x })), db)).toMatchObject({ create: [], update: [] })
  })

  it('a DB roster row reads back exactly as the sheet row', () => {
    const { roster } = parseCrewSheetRows(SHEET as never[])
    const { records } = rosterRecords('ops', roster)
    for (const rec of records) {
      const back = toRosterRow(rec)
      expect(back).toEqual(roster.find((m) => (m.id || '') === (rec.memberId ?? '') && m.name === rec.name))
    }
  })
})

describe('crew-lead decisions are identical in both modes', () => {
  const { roster } = parseCrewSheetRows(SHEET as never[])
  const dbRoster: RosterRow[] = rosterRecords('ops', roster).records.map(toRosterRow)

  beforeEach(() => {
    vi.mocked(getCrewMappings).mockResolvedValue({ cached: true, crews: [{ id: 'ops', label: 'Ops', turtles: [], sheet: 'https://docs.google.com/spreadsheets/d/x/edit' }] })
    vi.mocked(fetchCrewRoster).mockResolvedValue(roster)
    vi.mocked(loadCrewRosterFromDb).mockResolvedValue(dbRoster)
    vi.mocked(findMemberIdByDiscordId).mockImplementation(async (d: string) => ({ d1: '1', d2: '2', d4: '4' } as Record<string, string>)[d] ?? null)
  })

  it.each([false, true])('db mode = %s', async (db) => {
    vi.mocked(crewRolesFromDb).mockResolvedValue(db)
    expect([...(await getCrewLeadMemberIds('ops'))]).toEqual(['1'])
    expect(await isCrewLead('d1', 'ops')).toBe(true)
    expect(await isCrewLead('d2', 'ops')).toBe(false)
    expect(await isCrewLead('d4', 'ops')).toBe(false) // "Former lead"
    expect(await isOnCrewRoster('d2', 'ops')).toBe(true)
    expect(await isOnCrewRoster('d9', 'ops')).toBe(false)
  })

  it.each([false, true])('a ranked status ("0. Lead", "1. Capo") is a lead; db mode = %s', async (db) => {
    const ranked = parseCrewSheetRows([
      r(['ID', 'Name', 'Status']),
      r(['5', 'Epsilon', '0. Lead']),
      r(['6', 'Zeta', '1. Capo']),
      r(['7', 'Eta', '2. Hot']),
      r([null, 'Theta', '0. Lead']),
    ] as never[]).roster
    vi.mocked(fetchCrewRoster).mockResolvedValue(ranked)
    vi.mocked(loadCrewRosterFromDb).mockResolvedValue(rosterRecords('ops', ranked).records.map(toRosterRow))
    vi.mocked(crewRolesFromDb).mockResolvedValue(db)
    expect([...(await getCrewLeadMemberIds('ops'))].sort()).toEqual(['5', '6'])
  })

  it('a database error fails closed', async () => {
    vi.mocked(crewRolesFromDb).mockResolvedValue(true)
    vi.mocked(loadCrewRosterFromDb).mockRejectedValue(new Error('db down'))
    expect(await isCrewLead('d1', 'ops')).toBe(false)
    expect(await isOnCrewRoster('d1', 'ops')).toBe(false)
  })
})

describe('roster editor', () => {
  it('validates member ids and rejects the same member twice', () => {
    const spec = crewRosterEditor('ops')
    expect(() => cleanRows(spec, [{ name: 'A', memberId: 'x1' }])).toThrow(/member id/)
    expect(() => cleanRows(spec, [{ name: 'A', memberId: '7' }, { name: 'B', memberId: '7' }])).toThrow(/duplicate/)
    expect(cleanRows(spec, [{ name: 'A' }, { name: 'A' }])).toHaveLength(2)
  })
})
