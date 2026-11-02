/**
 * The manuals index: the manuals sheet (SHEET_IDS.manuals), or the Manual table once
 * `sheets.source.manuals` is "db" (plans/sheets-cutover.md). Manual content stays in the linked
 * documents; only the index moves.
 */
import type { TableConfig } from '@/app/lib/table-parser'
import { getColumnValue, parseTable } from '@/app/lib/table-parser'
import type { GvizRow, GvizTable } from '@/app/lib/types/gviz'

export type Manual = {
  title: string
  url: string | null
  crew: string
  crewId: string
  status: string
  authorId: string
  author: string
  lastUpdated: string
  notes: string
}

/**
 * Manual table parsing configuration
 * Handles Google Sheets Tables mode with anchor-based detection
 */
export const MANUAL_TABLE_CONFIG: TableConfig = {
  anchorKeywords: ['manuals', 'manual'],
  headerMappings: [
    ['manual', ['manual', 'manuals', 'title', 'name']],
    ['crew', ['crew', 'team', 'group']],
    ['status', ['status', 'state', 'stage']],
    ['authorId', ['author id', 'authorid', 'member id']],
    ['author', ['author', 'creator', 'owner', 'by']],
    ['lastUpdated', ['last updated', 'updated', 'date', 'modified']],
    ['notes', ['notes', 'note', 'comments', 'description']],
  ],
  requiredColumns: ['manual'],
}

// Convert crew label to ID (slug format)
export function crewLabelToId(label: string): string {
  return label.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/**
 * Parse a row into a Manual object
 * Returns null if the row should be skipped (empty or header row)
 */
export function parseManualRow(
  row: GvizRow,
  columns: Record<string, number>,
  _rowIndex: number,
  linkMap: Record<string, string>
): Manual | null {
  const title = getColumnValue(row, columns, 'manual')

  // Skip empty rows
  if (!title) return null

  // Skip header rows that might have been duplicated
  const titleLower = title.toLowerCase().trim()
  if (titleLower === 'manual' || titleLower === 'manuals' || titleLower === 'title') {
    return null
  }

  const crew = getColumnValue(row, columns, 'crew')

  return {
    title,
    url: linkMap[title] || null,
    crew,
    crewId: crewLabelToId(crew),
    status: getColumnValue(row, columns, 'status'),
    authorId: getColumnValue(row, columns, 'authorId'),
    author: getColumnValue(row, columns, 'author'),
    lastUpdated: getColumnValue(row, columns, 'lastUpdated'),
    notes: getColumnValue(row, columns, 'notes'),
  }
}

/** Every manual in the sheet's index table, in sheet order. Pure. */
export function parseManualsTable(table: GvizTable, linkMap: Record<string, string>): Manual[] {
  return parseTable<Manual>(table, MANUAL_TABLE_CONFIG, (row, columns, rowIndex) => parseManualRow(row, columns, rowIndex, linkMap))
}

/** The manuals index from the database (active rows, in order). */
export async function listManualsFromDb(): Promise<Manual[]> {
  const { prisma } = await import('@/app/lib/db')
  const rows = await prisma.manual.findMany({ where: { active: true }, orderBy: { position: 'asc' } })
  return rows.map((r) => ({
    title: r.title,
    url: r.url,
    crew: r.crew,
    crewId: crewLabelToId(r.crew),
    status: r.status,
    authorId: r.authorId,
    author: r.author,
    lastUpdated: r.lastUpdated,
    notes: r.notes,
  }))
}

export async function manualsFromDb(): Promise<boolean> {
  const { usesDb } = await import('@/app/lib/sheets-import/source')
  return usesDb('manuals')
}
