// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/app/lib/db', () => ({ prisma: {} }))
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))

import type { GvizRow } from '@/app/lib/types/gviz'
import { findMemberRow, memberIdColumn, rowToRecord, type MembersTable } from '@/app/lib/sheets/member-repository'
import { nextMemberId, parseSignedUpMembers } from '@/app/lib/member-registration'
import { buildMembersTable, memberValueRows, type MembersPayload } from './db-table'
import { planMemberUpsert, type MemberRowLike } from './upsert'
import { memberRecords } from '@/app/lib/sheets-import/members'
import { planUpserts } from '@/app/lib/sheets-import/plan'

// Synthetic members sheet: banner row, header row (column A has no header), rows sorted by id.
const HEADERS = ['', 'Status', 'Name', 'City', 'Crews', 'Turtles', 'Skills', 'DiscordID', 'Notes', 'Wallet', 'X']
const row = (cells: Array<string | number | null>): GvizRow => ({ c: cells.map((v) => (v === null ? null : { v })) as never })
function sheetTable(): MembersTable {
  const allRows = [
    row(['Crew', null, null]),
    { c: HEADERS.map((h) => (h ? { v: h } : null)) } as GvizRow,
    row([1, 'Active', 'Alpha', 'Rome', 'Ops', 'Leonardo', '', '111111111111111111', 'note a', '0xabc', '']),
    row([2, 'Active', 'Beta', 'Lima', '', '', '', '', '', '', '']),
    row([5, '', 'Epsilon', '', 'Art', '', '', '555555555555555555']),
    row([null, '', 'No id here', '', '', '', '', '', '', '', '']),
  ]
  return { allRows, headerRowIndex: 1, headers: HEADERS.map((h) => h.trim()), rows: allRows.slice(2) }
}

function payloadFromImport(t: MembersTable): MembersPayload {
  const { records } = memberRecords(t)
  const layout = records.find((r) => r.value.kind === 'layout')!.value as { headers: string[] }
  return {
    headers: layout.headers,
    rows: records.filter((r) => r.value.kind === 'member').map((r) => ({ id: r.key, cells: (r.value as { cells: never }).cells, position: (r.value as { position: number }).position })),
    version: 'v1',
  }
}

describe('members table: database path equals the sheet path', () => {
  it('every member row reads back identically (records, lookups, id allocation)', () => {
    const sheet = sheetTable()
    const db = buildMembersTable(payloadFromImport(sheet)) as MembersTable
    expect(db.headers).toEqual(sheet.headers)
    expect(memberIdColumn(db)).toBe(memberIdColumn(sheet))
    for (const id of ['1', '2', '5']) {
      expect(rowToRecord(db, findMemberRow(db, id)!)).toEqual(rowToRecord(sheet, findMemberRow(sheet, id)!))
    }
    // The row without an id is not a member on either side.
    expect(db.rows).toHaveLength(3)
    const values = memberValueRows(payloadFromImport(sheet))
    expect(nextMemberId(values, '999999999999999999')).toBe('3')
    expect([...parseSignedUpMembers(values).keys()]).toEqual(['111111111111111111', '555555555555555555'])
  })

  it('import reports rows without an id and is idempotent', () => {
    const { records, issues, extra } = memberRecords(sheetTable())
    expect(extra).toMatchObject({ members: 3, rowsWithoutId: 1, duplicateIds: 0 })
    expect(issues).toEqual([{ row: 6, code: 'missing-id' }])
    const db = new Map(records.map((r) => [r.key, r.value]))
    expect(planUpserts(records, db)).toMatchObject({ create: [], update: [], unchanged: 4 })
    expect(JSON.stringify(issues)).not.toContain('No id here')
  })
})

describe('member writes follow the web app rules', () => {
  const members = (): MemberRowLike[] => payloadFromImport(sheetTable()).rows
  const NOW = '2026-11-02T00:00:00.000Z'
  const col = (h: string) => HEADERS.indexOf(h)

  it('claim mode must match the typed id and never inserts', () => {
    expect(planMemberUpsert(HEADERS, members(), { source: 'onboarding_claim', discordId: '9' }, NOW)).toEqual({ ok: false, error: 'Claim requires memberId.' })
    const miss = planMemberUpsert(HEADERS, members(), { source: 'onboarding_claim', memberId: '77', discordId: '9' }, NOW)
    expect(miss.ok).toBe(false)
    const hit = planMemberUpsert(HEADERS, members(), { source: 'onboarding_claim', memberId: '2', discordId: '222222222222222222', discordJoined: true }, NOW)
    expect(hit).toMatchObject({ ok: true, action: 'updated', targetId: '2' })
    if (hit.ok && !hit.skipped) expect(hit.cells[col('DiscordID')]).toEqual({ v: '222222222222222222' })
  })

  it('never re-points a row to another Discord account outside the claim flows', () => {
    const r = planMemberUpsert(HEADERS, members(), { source: 'skills-update', memberId: '1', discordId: '999', skills: 'x' }, NOW)
    expect(r).toEqual({ ok: false, error: 'DiscordId conflict: row is linked to a different Discord account.' })
  })

  it('updates only the fields sent, appends a note, defaults status', () => {
    const r = planMemberUpsert(HEADERS, members(), { source: 'join-crew', memberId: '5', crews: ['Art', 'Ops'] }, NOW)
    expect(r).toMatchObject({ ok: true, action: 'updated' })
    if (!r.ok || r.skipped) return
    expect(r.cells[col('Crews')]).toEqual({ v: 'Art, Ops' })
    expect(r.cells[col('Name')]).toEqual({ v: 'Epsilon' })
    expect(r.cells[col('Status')]).toEqual({ v: 'Active' })
    expect(String(r.cells[col('Notes')]?.v)).toContain('Onboarded: (no name provided) (ID: 5)')
  })

  it('inserts a new member only with an id; matches by Discord id as a fallback', () => {
    expect(planMemberUpsert(HEADERS, members(), { source: 'web', discordId: '123' }, NOW)).toMatchObject({ ok: false })
    const ins = planMemberUpsert(HEADERS, members(), { source: 'web', memberId: '3', discordId: '333', mafiaName: 'Gamma', turtles: ['Raphael'] }, NOW)
    expect(ins).toMatchObject({ ok: true, action: 'inserted', targetId: '3', previousId: null })
    if (ins.ok && !ins.skipped) {
      expect(ins.cells[0]).toEqual({ v: 3 })
      expect(ins.cells[col('Turtles')]).toEqual({ v: 'Raphael' })
    }
    const byDiscord = planMemberUpsert(HEADERS, members(), { source: 'x-connect', discordId: '555555555555555555', x: 'handle' }, NOW)
    expect(byDiscord).toMatchObject({ ok: true, action: 'updated_by_discord', targetId: '5' })
  })

  it('turtles sent as text are stored as that text', () => {
    const r = planMemberUpsert(HEADERS, members(), { source: 'onboarding_auto_claim', memberId: '2', discordId: '', turtles: 'Leonardo, Donatello' }, NOW)
    if (r.ok && !r.skipped) expect(r.cells[col('Turtles')]).toEqual({ v: 'Leonardo, Donatello' })
  })
})
