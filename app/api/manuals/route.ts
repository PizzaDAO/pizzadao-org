import { fetchGviz, type GvizCacheOptions } from "@/app/lib/sheets/gviz";
import { SHEET_IDS } from "@/app/lib/sheets/config";
import {
  TableConfig,
  parseTable,
  getColumnValue,
  isTablesModeDetected,
} from "@/app/lib/table-parser";
import { NextResponse } from 'next/server'
import { getManualLinks, getManualLinksDebug, ManualLinksDebugResult } from '@/app/api/lib/google-sheets'
import { cacheDel } from '@/app/api/lib/cache'
import { GvizRow, GvizTable } from "@/app/lib/types/gviz";
import { internalError } from "@/app/lib/errors/error-response";

const MANUALS_SHEET_ID = SHEET_IDS.manuals

/** Read-only config sheet: 5-minute data cache unless ?fresh=1. */
const MANUALS_REVALIDATE_SECONDS = 300

/**
 * Manual table parsing configuration
 * Handles Google Sheets Tables mode with anchor-based detection
 */
const MANUAL_TABLE_CONFIG: TableConfig = {
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
function crewLabelToId(label: string): string {
  return label.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

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
 * Parse a row into a Manual object
 * Returns null if the row should be skipped (empty or header row)
 */
function parseManualRow(
  row: GvizRow,
  columns: Record<string, number>,
  rowIndex: number,
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

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const crewFilter = url.searchParams.get('crew')?.toLowerCase()
    const debugMode = url.searchParams.get('debug') === '1'
    const forceRefresh = url.searchParams.get('fresh') === '1'

    // Clear cache if force refresh
    if (forceRefresh) {
      await cacheDel(`manual-links:${MANUALS_SHEET_ID}`)
    }

    // Fetch spreadsheet data via GViz API and hyperlinks via Sheets API in parallel
    // Note: headers=1 tells GViz to treat first row as headers (but Tables mode ignores this)
    const cacheOpts: GvizCacheOptions = forceRefresh
      ? { fresh: true }
      : { revalidate: MANUALS_REVALIDATE_SECONDS }
    const loadManualsSheet = () =>
      fetchGviz(MANUALS_SHEET_ID, { headers: 1 }, cacheOpts).catch(() => {
        throw new Error('Failed to fetch manuals spreadsheet')
      })

    // Use debug version when debug mode is enabled
    let linkMap: Record<string, string>
    let debugInfo: ManualLinksDebugResult | null = null

    if (debugMode) {
      const [gviz, debugResult] = await Promise.all([
        loadManualsSheet(),
        getManualLinksDebug(MANUALS_SHEET_ID),
      ])
      debugInfo = debugResult
      linkMap = debugResult.linkMap

      const table = gviz?.table as GvizTable

      if (!table) {
        throw new Error('No table data in GViz response')
      }

      // Parse manuals using the robust table parser
      const allManuals = parseTable<Manual>(
        table,
        MANUAL_TABLE_CONFIG,
        (row, columns, rowIndex) => parseManualRow(row, columns, rowIndex, linkMap)
      )

      // Apply crew filter if specified
      const manuals = crewFilter
        ? allManuals.filter(m => m.crew.toLowerCase() === crewFilter)
        : allManuals

      return NextResponse.json({ manuals, _debug: debugInfo }, {
        headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' }
      })
    }

    const [gviz, linkMapResult] = await Promise.all([
      loadManualsSheet(),
      getManualLinks(MANUALS_SHEET_ID),
    ])
    linkMap = linkMapResult

    const table = gviz?.table as GvizTable

    if (!table) {
      throw new Error('No table data in GViz response')
    }

    // Check if we're in Tables mode (for logging/debugging)
    // Note: isTablesModeDetected is called internally by parseTable
    void isTablesModeDetected(table) // Explicit acknowledgment for debugging

    // Parse manuals using the robust table parser
    // This handles:
    // - Dynamic header row detection
    // - Tables mode (concatenated column labels)
    // - Various column naming conventions
    const allManuals = parseTable<Manual>(
      table,
      MANUAL_TABLE_CONFIG,
      (row, columns, rowIndex) => parseManualRow(row, columns, rowIndex, linkMap)
    )

    // Apply crew filter if specified
    const manuals = crewFilter
      ? allManuals.filter(m => m.crew.toLowerCase() === crewFilter)
      : allManuals

    return NextResponse.json({ manuals }, {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' }
    })
  } catch (e: unknown) {
    return internalError(e, 'manuals', 'Failed to load manuals')
  }
}
