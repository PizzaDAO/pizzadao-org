// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = { row: null as null | Record<string, unknown>, member: null as null | { id: string; cells: unknown[] } }
const tx = {
  $executeRaw: vi.fn(async () => 0),
  memberTableLayout: { findUnique: vi.fn(async () => ({ headers: ['', 'Name', 'Crews'] })) },
  member: {
    findUnique: vi.fn(async () => state.member),
    update: vi.fn(async ({ data }: { data: { cells: unknown[] } }) => {
      state.member = { ...state.member!, cells: data.cells }
    }),
  },
}
vi.mock('@/app/lib/db', () => ({
  prisma: {
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    announceState: {
      findUnique: vi.fn(async () => state.row),
      upsert: vi.fn(async ({ update }: { update: Record<string, unknown> }) => {
        state.row = { ...(state.row ?? {}), ...update }
      }),
    },
    announcement: { findMany: vi.fn(async () => [{ text: 'Pizza party', url: null, crew: 'Ops', status: 'To Do' }]) },
  },
}))
vi.mock('@/app/lib/sheets/member-repository', () => ({ invalidateMembersCache: vi.fn() }))
vi.mock('@/app/lib/crew-mappings', () => ({ getCrewMappings: vi.fn(async () => ({ crews: [{ id: 'art', label: 'Art' }] })) }))
vi.mock('@/app/lib/sheets-import/source', () => ({ membersMirrorEnabled: vi.fn(async () => false), usesDb: vi.fn(async () => false) }))

import { createAnnounceDbIO, DB_LAST_ERROR_CELL, DB_LAST_SENT_CELL, DB_SEND_CELL } from '@/app/lib/announce/db'
import { updateMemberCrewsInDb, RosterWritebackError } from '@/app/lib/roster-writeback'
import { announceRecords } from './announce'
import { planUpserts } from './plan'

beforeEach(() => {
  state.row = { sendValue: 'Sent', lastSentValue: '2026-11-01 10:00:00', lastError: '' }
  state.member = { id: '7', cells: [{ v: 7 }, { v: 'Someone' }, { v: 'Ops' }] }
})

describe('announcement from the database', () => {
  it('reads the same block shape the runner uses and writes only the status fields', async () => {
    const io = createAnnounceDbIO()
    const block = await io.readBlock()
    expect(block).toEqual({
      sendCell: DB_SEND_CELL, lastSentCell: DB_LAST_SENT_CELL, lastErrorCell: DB_LAST_ERROR_CELL,
      sendValue: 'Sent', lastSentValue: '2026-11-01 10:00:00',
      specials: [{ text: 'Pizza party', url: null, crew: 'Ops', status: 'To Do' }],
    })
    await io.writeCells([{ range: DB_SEND_CELL, value: '' }, { range: "'Crews'!B2", value: 'ignored' }, { range: DB_LAST_ERROR_CELL, value: 'boom' }])
    expect(state.row).toMatchObject({ sendValue: '', lastError: 'boom', lastSentValue: '2026-11-01 10:00:00' })
  })

  it('import records are idempotent', () => {
    const recs = announceRecords({ sendCell: null, lastSentCell: null, lastErrorCell: null, sendValue: '', lastSentValue: '', specials: [{ text: 'A', url: null, crew: '', status: 'To Do' }, { text: 'A', url: null, crew: '', status: 'Done' }] })
    expect(recs.map((r) => r.key)).toEqual(['__state__', 'a', 'a#2'])
    expect(planUpserts(recs, new Map(recs.map((r) => [r.key, r.value])))).toMatchObject({ create: [], update: [] })
  })
})

describe('roster write-back on the Member table', () => {
  it('dry run previews, apply needs the previewed value, add is idempotent', async () => {
    const dry = await updateMemberCrewsInDb({ memberId: '7', crewId: 'art', action: 'add' })
    expect(dry).toMatchObject({ mode: 'dry-run', applied: false, changed: true, before: 'Ops', after: 'Ops, Art' })
    await expect(updateMemberCrewsInDb({ memberId: '7', crewId: 'art', action: 'add', mode: 'apply', expectedBefore: 'stale' })).rejects.toBeInstanceOf(RosterWritebackError)
    const applied = await updateMemberCrewsInDb({ memberId: '7', crewId: 'art', action: 'add', mode: 'apply', expectedBefore: 'Ops' })
    expect(applied).toMatchObject({ applied: true, after: 'Ops, Art' })
    expect(state.member!.cells[2]).toEqual({ v: 'Ops, Art' })
    const again = await updateMemberCrewsInDb({ memberId: '7', crewId: 'art', action: 'add', mode: 'apply', expectedBefore: 'Ops, Art' })
    expect(again).toMatchObject({ applied: false, changed: false })
  })

  it('refuses unknown members and crews', async () => {
    state.member = null
    await expect(updateMemberCrewsInDb({ memberId: '8', crewId: 'ops', action: 'remove' })).rejects.toMatchObject({ status: 404 })
    await expect(updateMemberCrewsInDb({ memberId: '7', crewId: 'nope', action: 'add' })).rejects.toMatchObject({ status: 400 })
  })
})
