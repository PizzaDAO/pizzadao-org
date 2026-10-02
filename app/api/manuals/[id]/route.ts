import { NextResponse } from 'next/server'
import { fetchGviz, type GvizCacheOptions } from '@/app/lib/sheets/gviz'
import { SHEET_IDS } from '@/app/lib/sheets/config'
import { norm } from '@/app/lib/strings'
import { getManualLinks, getManualLinksDebug, ManualLinksDebugResult } from '@/app/api/lib/google-sheets'
import { cacheDel } from '@/app/api/lib/cache'
import { internalError } from '@/app/lib/errors/error-response'

const MANUALS_SHEET_ID = SHEET_IDS.manuals

/** Read-only sheets: 5-minute data cache unless ?fresh=1. */
const MANUALS_REVALIDATE_SECONDS = 300


function cellVal(cell: any): string {
  return norm(cell?.v ?? cell?.f ?? '')
}

// Extract URL from GViz cell (fallback for when Sheets API doesn't return hyperlinks)
// This matches the approach used in crew route's parseAgenda
function extractUrl(cell: any): string | null {
  if (!cell) return null

  // Check for GViz link property (how GViz returns Ctrl+K hyperlinks)
  if (cell.l) return cell.l

  // Check for explicit hyperlink in cell properties
  if (cell.hyperlink) return cell.hyperlink

  // Check formatted value for URL patterns
  const text = String(cell?.f ?? cell?.v ?? '')

  // Try to extract URL from HYPERLINK formula pattern
  const hyperlinkMatch = text.match(/HYPERLINK\s*\(\s*"([^"]+)"/i)
  if (hyperlinkMatch) return hyperlinkMatch[1]

  // Try to extract URL in parentheses: (https://...)
  const parenMatch = text.match(/\((https?:\/\/[^\s\)]+)\)/)
  if (parenMatch) return parenMatch[1]

  // Try to extract raw URL from text
  const urlMatch = text.match(/https?:\/\/[^\s"<>\)]+/)
  if (urlMatch) return urlMatch[0]

  return null
}

type Manual = {
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

// Convert crew label to ID (slug format)
function crewLabelToId(label: string): string {
  return label.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

// Extract Google Sheet ID from URL
function extractSheetId(url: string | null): string | null {
  if (!url) return null
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/)
  return match ? match[1] : null
}

// Cell data with optional link
type CellData = {
  value: string
  url: string | null
}

// Fetch sheet content and return as structured data (like agenda)
// Now also extracts hyperlinks from cells
async function fetchSheetContent(sheetId: string, cacheOpts: GvizCacheOptions): Promise<{
  headers: string[]
  rows: CellData[][]
} | null> {
  try {
    const gviz = await fetchGviz(sheetId, { headers: 0 }, cacheOpts)
    const rawRows = gviz?.table?.rows || []

    if (rawRows.length === 0) {
      return null
    }

    // Parse all rows with link extraction
    const allRows: CellData[][] = []
    for (const row of rawRows) {
      const cells = row?.c || []
      const rowData: CellData[] = cells.map((cell: any) => ({
        value: cellVal(cell),
        url: extractUrl(cell)
      }))
      // Skip completely empty rows
      if (rowData.some((d: CellData) => d.value.length > 0)) {
        allRows.push(rowData)
      }
    }

    if (allRows.length === 0) {
      return null
    }

    // First non-empty row is headers (just the text values), rest are data rows with links
    const headers = allRows[0].map(d => d.value)
    const dataRows = allRows.slice(1)

    return { headers, rows: dataRows }
  } catch (e) {
    console.error('Failed to fetch sheet content:', e)
    return null
  }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const manualIndex = parseInt(id, 10)

    if (isNaN(manualIndex) || manualIndex < 0) {
      return NextResponse.json({ error: 'Invalid manual ID' }, { status: 400 })
    }

    // Check for debug and refresh params
    const url = new URL(req.url)
    const debugMode = url.searchParams.get('debug') === '1'
    const forceRefresh = url.searchParams.get('fresh') === '1'

    // Clear cache if force refresh
    if (forceRefresh) {
      await cacheDel(`manual-links:${MANUALS_SHEET_ID}`)
    }

    // Fetch spreadsheet data and hyperlinks
    const cacheOpts: GvizCacheOptions = forceRefresh
      ? { fresh: true }
      : { revalidate: MANUALS_REVALIDATE_SECONDS }
    const loadManualsSheet = () =>
      fetchGviz(MANUALS_SHEET_ID, { headers: 1 }, cacheOpts).catch(() => {
        throw new Error('Failed to fetch manuals spreadsheet')
      })

    let linkMap: Record<string, string>
    let debugInfo: ManualLinksDebugResult | null = null
    let gviz: Awaited<ReturnType<typeof fetchGviz>>

    if (debugMode) {
      const [sheet, debugResult] = await Promise.all([
        loadManualsSheet(),
        getManualLinksDebug(MANUALS_SHEET_ID),
      ])
      gviz = sheet
      debugInfo = debugResult
      linkMap = debugResult.linkMap
    } else {
      const [sheet, linkMapResult] = await Promise.all([
        loadManualsSheet(),
        getManualLinks(MANUALS_SHEET_ID),
      ])
      gviz = sheet
      linkMap = linkMapResult
    }

    const rows = gviz?.table?.rows || []

    // Parse all manuals
    const manuals: Manual[] = []
    for (const row of rows) {
      const cells = row?.c || []
      const title = cellVal(cells[0])
      if (!title) continue

      // Priority: 1. Sheets API link map (Ctrl+K/rich text links)  2. GViz extraction (cell.l)
      const titleCell = cells[0]
      const url = linkMap[title] || extractUrl(titleCell)
      const crew = cellVal(cells[1])

      manuals.push({
        title,
        url,
        crew,
        crewId: crewLabelToId(crew),
        status: cellVal(cells[2]),
        authorId: cellVal(cells[3]),
        author: cellVal(cells[4]),
        lastUpdated: cellVal(cells[5]),
        notes: cellVal(cells[6]),
      })
    }

    // Get manual by index
    if (manualIndex >= manuals.length) {
      return NextResponse.json({ error: 'Manual not found' }, { status: 404 })
    }

    const manual = manuals[manualIndex]
    const sheetId = extractSheetId(manual.url)

    let sheetContent: { headers: string[]; rows: CellData[][] } | null = null
    let contentError: string | null = null

    if (sheetId) {
      sheetContent = await fetchSheetContent(sheetId, cacheOpts)
      if (!sheetContent) {
        contentError = 'Unable to load sheet content. The sheet may be private or the link may be broken.'
      }
    } else if (manual.url) {
      contentError = 'Could not parse Google Sheet link. The URL format may not be recognized.'
    } else {
      contentError = 'No Google Sheet link is available for this manual.'
    }

    return NextResponse.json({
      manual,
      sheetContent,
      contentError,
      ...(debugInfo ? { _debug: debugInfo } : {}),
    }, {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' }
    })
  } catch (e: unknown) {
    return internalError(e, 'manuals/[id]', 'Failed to load manual')
  }
}
