/**
 * The members table from the database (plans/sheets-cutover.md PR 7, phase A): Member rows are
 * turned back into the exact GViz-shaped MembersTable the sheet path returns (header row, then one
 * row per member, sorted by id like the sheet's auto-sort), so every reader stays unchanged.
 *
 * Server-side only. The cells include private columns: only the existing allow-listed readers
 * (members-list.ts and friends) may turn them into public output.
 */
import type { GvizCell, GvizRow } from '@/app/lib/types/gviz'
import type { MemberCells } from './upsert'

export interface MembersPayload {
  headers: string[]
  rows: Array<{ id: string; cells: MemberCells; position: number }>
  /** Changes whenever any member row or the layout changes (memo key). */
  version: string
}

/** The sheet sorts rows by ID ascending after every write: numbers first, then text. */
export function compareMemberIds(a: { id: string; position: number }, b: { id: string; position: number }): number {
  const na = /^\d+$/.test(a.id) ? Number(a.id) : NaN
  const nb = /^\d+$/.test(b.id) ? Number(b.id) : NaN
  if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb
  if (!Number.isNaN(na) && Number.isNaN(nb)) return -1
  if (Number.isNaN(na) && !Number.isNaN(nb)) return 1
  if (Number.isNaN(na) && Number.isNaN(nb) && a.id !== b.id) return a.id < b.id ? -1 : 1
  return a.position - b.position
}

export function buildMembersTable(payload: MembersPayload) {
  const headers = payload.headers.map((h) => String(h ?? '').trim())
  const headerRow: GvizRow = { c: headers.map((h) => (h ? { v: h } : null)) as GvizCell[] }
  const sorted = [...payload.rows].sort(compareMemberIds)
  const rows: GvizRow[] = sorted.map((m) => ({ c: (Array.isArray(m.cells) ? m.cells : []) as GvizCell[] }))
  return { allRows: [headerRow, ...rows], headerRowIndex: 0, headers, rows }
}

/** The table as plain values (header row first), for the id allocation and signup checks. */
export function memberValueRows(payload: MembersPayload): unknown[][] {
  const sorted = [...payload.rows].sort(compareMemberIds)
  return [payload.headers, ...sorted.map((m) => (Array.isArray(m.cells) ? m.cells : []).map((c) => c?.v ?? c?.f ?? ''))]
}

/** `includeMerged` also returns tombstoned (merged-away) rows: id allocation must treat their ids as taken. */
export async function loadMembersPayload(opts: { includeMerged?: boolean } = {}): Promise<MembersPayload> {
  const { prisma } = await import('@/app/lib/db')
  const [layout, rows] = await Promise.all([
    prisma.memberTableLayout.findUnique({ where: { id: 1 } }),
    prisma.member.findMany({ where: opts.includeMerged ? {} : { mergedInto: null }, select: { id: true, cells: true, position: true, updatedAt: true } }),
  ])
  if (!layout) throw new Error('Members table is not imported yet')
  let latest = layout.updatedAt.getTime()
  for (const r of rows) latest = Math.max(latest, r.updatedAt.getTime())
  return {
    headers: (Array.isArray(layout.headers) ? layout.headers : []).map((h) => String(h ?? '')),
    rows: rows.map((r) => ({ id: r.id, cells: (Array.isArray(r.cells) ? r.cells : []) as MemberCells, position: r.position })),
    version: `${rows.length}:${latest}`,
  }
}
