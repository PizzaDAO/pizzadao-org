import { NextResponse } from 'next/server'
import { parseGvizJson } from "@/app/lib/gviz-parser"
import { getManualLinks, getManualLinksDebug, ManualLinksDebugResult } from '@/app/api/lib/google-sheets'
import { cacheDel } from '@/app/api/lib/cache'

const MANUALS_SHEET_ID = '1KDAzz8qQubCaFiplWaUFBgCZlHR_mIA0IJHKNqgK5hg'

function norm(s: unknown): string {
  return String(s ?? '').trim().replace(/\s+/g, ' ')
}

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
  status: string
  authorId: string
  author: string
  lastUpdated: string
  notes: string
}

// Extract Google Sheet ID from URL
function extractSheetId(url: string | null): string | null {
  if (!url) return null
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/)
  return match ? match[1] : null
}

// Fetch sheet content and return as structured data (like agenda)
async function fetchSheetContent(sheetId: string): Promise<{
  headers: string[]
  rows: string[][]
} | null> {
  try {
    const gvizUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&headers=0`
    const res = await fetch(gvizUrl, { cache: 'no-store' })

    if (!res.ok) {
      return null
    }

    const text = await res.text()
    const gviz = parseGvizJson(text)
    const rawRows = gviz?.table?.rows || []

    if (rawRows.length === 0) {
      return null
    }

    // Parse all rows
    const allRows: string[][] = []
    for (const row of rawRows) {
      const cells = row?.c || []
      const rowValues = cells.map(cellVal)
      // Skip completely empty rows
      if (rowValues.some((v: string) => v.length > 0)) {
        allRows.push(rowValues)
      }
    }

    if (allRows.length === 0) {
      return null
    }

    // First non-empty row is headers, rest are data rows
    const headers = allRows[0]
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
    const gvizUrl = `https://docs.google.com/spreadsheets/d/${MANUALS_SHEET_ID}/gviz/tq?tqx=out:json&headers=1`

    let linkMap: Record<string, string>
    let debugInfo: ManualLinksDebugResult | null = null
    let sheetRes: Response

    if (debugMode) {
      const [fetchRes, debugResult] = await Promise.all([
        fetch(gvizUrl, { cache: 'no-store' }),
        getManualLinksDebug(MANUALS_SHEET_ID),
      ])
      sheetRes = fetchRes
      debugInfo = debugResult
      linkMap = debugResult.linkMap
    } else {
      const [fetchRes, linkMapResult] = await Promise.all([
        fetch(gvizUrl, { cache: 'no-store' }),
        getManualLinks(MANUALS_SHEET_ID),
      ])
      sheetRes = fetchRes
      linkMap = linkMapResult
    }

    if (!sheetRes.ok) {
      throw new Error('Failed to fetch manuals spreadsheet')
    }

    const text = await sheetRes.text()
    const gviz = parseGvizJson(text)
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

      manuals.push({
        title,
        url,
        crew: cellVal(cells[1]),
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

    let sheetContent: { headers: string[]; rows: string[][] } | null = null
    let contentError: string | null = null

    if (sheetId) {
      sheetContent = await fetchSheetContent(sheetId)
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
    })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to load manual' },
      { status: 500 }
    )
  }
}
