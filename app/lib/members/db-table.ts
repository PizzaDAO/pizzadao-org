/**
 * The members table from the database (plans/sheets-cutover.md PR 7, phase A): Member rows are
 * turned back into the exact GViz-shaped MembersTable the sheet path returns (header row, then one
 * row per member, sorted by id like the sheet's auto-sort), so every reader stays unchanged.
 *
 * Server-side only. The cells include private columns: only the existing allow-listed readers
 * (members-list.ts and friends) may turn them into public output.
 */
import { createHash } from 'crypto'
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

type MemoRow = { cells: MemberCells; position: number; updatedAt: number; merged: boolean }

/**
 * Every Member row this instance has loaded, by id. A load first reads only (id, updatedAt,
 * mergedInto) for the whole table and then fetches the cells of just the rows that are new or
 * changed since, so a full read moves a few KB instead of every member's cells. App writes go
 * through Prisma, which stamps updatedAt (@updatedAt). A manual SQL edit of a Member row must set
 * "updatedAt" = now() as well; one that does not is still picked up by the periodic full reload.
 */
const rowMemo = new Map<string, MemoRow>()

/**
 * How old this instance's last full load (every row's cells) may get before the next load is a
 * full one again: the backstop for writes that did not bump updatedAt.
 */
export const MEMBERS_FULL_RELOAD_MS = 15 * 60_000
let lastFullLoadAt = 0

/** Test hook: forget the rows this instance has loaded. */
export function clearMembersRowMemo(): void {
  rowMemo.clear()
  lastFullLoadAt = 0
}

/** `includeMerged` also returns tombstoned (merged-away) rows: id allocation must treat their ids as taken. */
export async function loadMembersPayload(opts: { includeMerged?: boolean; now?: number } = {}): Promise<MembersPayload> {
  const { prisma } = await import('@/app/lib/db')
  const now = opts.now ?? Date.now()
  const [layout, stamps] = await Promise.all([
    prisma.memberTableLayout.findUnique({ where: { id: 1 } }),
    prisma.member.findMany({ select: { id: true, updatedAt: true, mergedInto: true } }),
  ])
  if (!layout) throw new Error('Members table is not imported yet')
  if (now - lastFullLoadAt > MEMBERS_FULL_RELOAD_MS) {
    rowMemo.clear()
    lastFullLoadAt = now
  }
  const changed = new Set(
    stamps
      .filter((s) => {
        const memo = rowMemo.get(s.id)
        return !memo || memo.updatedAt !== s.updatedAt.getTime() || memo.merged !== (s.mergedInto != null)
      })
      .map((s) => s.id),
  )
  const fetched = new Map<string, { cells: unknown; position: number; updatedAt: Date; mergedInto: string | null }>()
  const ids = [...changed]
  for (let i = 0; i < ids.length; i += 1000) {
    const rows = await prisma.member.findMany({
      where: { id: { in: ids.slice(i, i + 1000) } },
      select: { id: true, cells: true, position: true, updatedAt: true, mergedInto: true },
    })
    for (const r of rows) fetched.set(r.id, r)
  }
  const out: MembersPayload['rows'] = []
  const seen = new Set<string>()
  // The full-load time is in the key too: a full reload may pick up an edit that kept its updatedAt.
  const hash = createHash('sha256').update(`${layout.updatedAt.getTime()}:${lastFullLoadAt}`)
  for (const s of stamps) {
    // A changed row comes from the second read (newer if written in between); one missing from it
    // was deleted in between and is dropped, never served from the memo.
    let row: MemoRow | undefined
    if (changed.has(s.id)) {
      const f = fetched.get(s.id)
      if (!f) continue
      row = { cells: (Array.isArray(f.cells) ? f.cells : []) as MemberCells, position: f.position, updatedAt: f.updatedAt.getTime(), merged: f.mergedInto != null }
      rowMemo.set(s.id, row)
    } else {
      row = rowMemo.get(s.id)
      if (!row) continue
    }
    seen.add(s.id)
    if (row.merged && !opts.includeMerged) continue
    hash.update(`|${s.id}:${row.updatedAt}:${row.merged ? 1 : 0}`)
    out.push({ id: s.id, cells: row.cells, position: row.position })
  }
  for (const id of rowMemo.keys()) if (!seen.has(id)) rowMemo.delete(id)
  return {
    headers: (Array.isArray(layout.headers) ? layout.headers : []).map((h) => String(h ?? '')),
    rows: out,
    // Any row added, removed, edited or merged changes it (memo key for the parsed table).
    version: `${out.length}:${hash.digest('hex').slice(0, 16)}`,
  }
}
