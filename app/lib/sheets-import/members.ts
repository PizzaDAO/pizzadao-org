/**
 * Members (plans/sheets-cutover.md PR 7): importer from the members sheet and a parity check of
 * the members table the app reads (sheet path vs database path). Counts only, never member data.
 *
 * Each row is stored as the read path saw it (GViz cells), so the database table rebuilt by
 * getMembersTable is the same table. Key: the member id (ID cell). Rows without an id are skipped
 * (row number reported); a repeated id keeps the first row.
 */
import { prisma } from '@/app/lib/db'
import { cellText, getMembersTableFromDb, getMembersTableFromSheet, memberIdColumn, type MembersTable } from '@/app/lib/sheets/member-repository'
import type { GvizCell } from '@/app/lib/types/gviz'
import { memberIndexFields, type MemberCells } from '@/app/lib/members/upsert'
import { compareKeyed, type Importer, type ParityReport, type ParseIssue } from './framework'
import { stableEqual } from './plan'

const LAYOUT_KEY = '__layout__'

export type MemberRecord = { kind: 'member'; cells: MemberCells; position: number } | { kind: 'layout'; headers: string[] }

/** A cell as stored: only the value and the formatted text (links and styles are not data). */
export function storedCell(c: GvizCell | null | undefined): GvizCell | null {
  if (!c) return null
  const out: GvizCell = {}
  if (c.v !== undefined) out.v = c.v
  if (c.f !== undefined) out.f = c.f
  return out
}

/** Cells without trailing empty cells, for comparing rows whatever their length. */
export function comparableCells(cells: ReadonlyArray<GvizCell | null | undefined>): Array<GvizCell | null> {
  const out = cells.map((c) => storedCell(c))
  while (out.length && (out[out.length - 1] === null || (out[out.length - 1]!.v == null && out[out.length - 1]!.f == null))) out.pop()
  return out
}

/** Records for the members table. Pure. */
export function memberRecords(table: MembersTable): { records: Array<{ key: string; value: MemberRecord }>; issues: ParseIssue[]; extra: Record<string, number> } {
  const idCol = memberIdColumn(table)
  const records: Array<{ key: string; value: MemberRecord }> = [{ key: LAYOUT_KEY, value: { kind: 'layout', headers: table.headers } }]
  const issues: ParseIssue[] = []
  const extra = { rows: 0, members: 0, rowsWithoutId: 0, duplicateIds: 0, duplicateDiscordIds: 0, withDiscordId: 0 }
  const seen = new Set<string>()
  const discord = new Set<string>()
  table.rows.forEach((row, i) => {
    extra.rows++
    const sheetRow = table.headerRowIndex + i + 2
    const cells = row?.c ?? []
    const id = cellText(cells[idCol])
    if (!id) {
      // Blank rows are common below the table; only report rows that hold something.
      if (cells.some((c) => cellText(c))) {
        extra.rowsWithoutId++
        issues.push({ row: sheetRow, code: 'missing-id' })
      }
      return
    }
    if (seen.has(id)) {
      extra.duplicateIds++
      issues.push({ row: sheetRow, code: 'duplicate-id' })
      return
    }
    seen.add(id)
    const { discordId } = memberIndexFields(table.headers, cells)
    if (discordId) {
      extra.withDiscordId++
      if (discord.has(discordId)) {
        extra.duplicateDiscordIds++
        issues.push({ row: sheetRow, code: 'duplicate-discord-id' })
      }
      discord.add(discordId)
    }
    extra.members++
    records.push({ key: id, value: { kind: 'member', cells: cells.map(storedCell), position: i } })
  })
  return { records, issues, extra }
}

export const membersImporter: Importer<MemberRecord> = {
  key: 'members',
  async load() {
    const table = await getMembersTableFromSheet({ fresh: true })
    if (table.headerRowIndex === -1) throw new Error('Header row not found in the members sheet')
    return memberRecords(table)
  },
  async existing() {
    const [layout, rows] = await Promise.all([prisma.memberTableLayout.findUnique({ where: { id: 1 } }), prisma.member.findMany({ select: { id: true, cells: true, position: true } })])
    const map = new Map<string, MemberRecord>()
    if (layout) map.set(LAYOUT_KEY, { kind: 'layout', headers: (layout.headers as string[]) ?? [] })
    for (const r of rows) map.set(r.id, { kind: 'member', cells: (r.cells as MemberCells) ?? [], position: r.position })
    return map
  },
  equal: (a, b) => {
    if (a.kind !== b.kind) return false
    if (a.kind === 'layout') return stableEqual(a.headers, (b as typeof a).headers)
    const bb = b as typeof a
    return a.position === bb.position && stableEqual(comparableCells(a.cells), comparableCells(bb.cells))
  },
  async apply(plan, progress) {
    const all = [...plan.create, ...plan.update]
    const layout = all.find((r) => r.value.kind === 'layout')?.value as { kind: 'layout'; headers: string[] } | undefined
    const headers = layout?.headers ?? ((await prisma.memberTableLayout.findUnique({ where: { id: 1 } }))?.headers as string[] | undefined) ?? []
    const ops: unknown[] = []
    if (layout) {
      ops.push(prisma.memberTableLayout.upsert({ where: { id: 1 }, create: { id: 1, headers: layout.headers as never, updatedBy: 'sheet-import' }, update: { headers: layout.headers as never, updatedBy: 'sheet-import' } }))
    }
    for (const r of all) {
      if (r.value.kind !== 'member') continue
      const { discordId, name } = memberIndexFields(headers, r.value.cells)
      const data = { cells: r.value.cells as never, position: r.value.position, discordId, name, updatedBy: 'sheet-import' }
      ops.push(prisma.member.upsert({ where: { id: r.key }, create: { id: r.key, ...data }, update: data }))
    }
    // Chunked; progress is logged so a failure part-way shows how far it got. Orphans (members no
    // longer in the sheet) are only reported, never deleted.
    for (let i = 0; i < ops.length; i += 100) {
      await prisma.$transaction(ops.slice(i, i + 100) as never)
      progress(Math.min(i + 100, ops.length))
    }
    const { invalidateMembersCache } = await import('@/app/lib/sheets/member-repository')
    invalidateMembersCache()
  },
}

/**
 * The members table the app reads, sheet path vs database path: the headers, and every row by
 * member id (cells compared without links, trailing blanks ignored). Counts only.
 */
export async function membersParity(): Promise<ParityReport> {
  const [sheet, db] = await Promise.all([getMembersTableFromSheet({ fresh: true }), getMembersTableFromDb({ fresh: true })])
  const keyed = (t: MembersTable) => {
    const idCol = memberIdColumn(t)
    const m = new Map<string, unknown>()
    m.set(LAYOUT_KEY, t.headers)
    for (const row of t.rows) {
      const id = cellText(row?.c?.[idCol])
      if (id && !m.has(id)) m.set(id, comparableCells(row?.c ?? []))
    }
    return m
  }
  const report = compareKeyed('members', keyed(sheet), keyed(db))
  return { ...report, byScope: { headersDiffer: stableEqual(sheet.headers, db.headers) ? 0 : 1 } }
}
