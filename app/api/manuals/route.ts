import { parseGvizJson } from "@/app/lib/gviz-parser";
import { NextResponse } from 'next/server'
import { getManualLinks, getManualLinksDebug, ManualLinksDebugResult } from '@/app/api/lib/google-sheets'
import { cacheDel } from '@/app/api/lib/cache'

const MANUALS_SHEET_ID = '1KDAzz8qQubCaFiplWaUFBgCZlHR_mIA0IJHKNqgK5hg'

// Helper to normalize strings
function norm(s: unknown): string {
  return String(s ?? '').trim().replace(/\s+/g, ' ')
}

// Parse GViz JSON response

// Get cell value
function cellVal(cell: any): string {
  return norm(cell?.v ?? cell?.f ?? '')
}

export type Manual = {
  title: string
  url: string | null
  crew: string
  status: string
  authorId: string
  author: string
  lastUpdated: string
  notes: string
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
    const gvizUrl = `https://docs.google.com/spreadsheets/d/${MANUALS_SHEET_ID}/gviz/tq?tqx=out:json&headers=1`

    // Use debug version when debug mode is enabled
    let linkMap: Record<string, string>
    let debugInfo: ManualLinksDebugResult | null = null

    if (debugMode) {
      const [sheetRes, debugResult] = await Promise.all([
        fetch(gvizUrl, { cache: 'no-store' }),
        getManualLinksDebug(MANUALS_SHEET_ID),
      ])
      debugInfo = debugResult
      linkMap = debugResult.linkMap

      if (!sheetRes.ok) {
        throw new Error('Failed to fetch manuals spreadsheet')
      }

      const text = await sheetRes.text()
      const gviz = parseGvizJson(text)
      const rows = gviz?.table?.rows || []

      // Parse manuals from rows
      const manuals: Manual[] = []

      for (const row of rows) {
        const cells = row?.c || []
        const title = cellVal(cells[0])
        if (!title) continue

        const crew = cellVal(cells[1])
        const status = cellVal(cells[2])

        if (crewFilter && crew.toLowerCase() !== crewFilter) {
          continue
        }

        manuals.push({
          title,
          url: linkMap[title] || null,
          crew,
          status,
          authorId: cellVal(cells[3]),
          author: cellVal(cells[4]),
          lastUpdated: cellVal(cells[5]),
          notes: cellVal(cells[6]),
        })
      }

      return NextResponse.json({ manuals, _debug: debugInfo })
    }

    const [sheetRes, linkMapResult] = await Promise.all([
      fetch(gvizUrl, { cache: 'no-store' }),
      getManualLinks(MANUALS_SHEET_ID),
    ])
    linkMap = linkMapResult

    if (!sheetRes.ok) {
      throw new Error('Failed to fetch manuals spreadsheet')
    }

    const text = await sheetRes.text()
    const gviz = parseGvizJson(text)
    const rows = gviz?.table?.rows || []

    // Parse manuals from rows
    // Expected columns: Manual, Crew, Status, Author ID, Author, Last Updated, Notes
    const manuals: Manual[] = []

    for (const row of rows) {
      const cells = row?.c || []
      const title = cellVal(cells[0])
      if (!title) continue

      const crew = cellVal(cells[1])
      const status = cellVal(cells[2])

      // Filter by crew if specified
      if (crewFilter && crew.toLowerCase() !== crewFilter) {
        continue
      }

      manuals.push({
        title,
        url: linkMap[title] || null,
        crew,
        status,
        authorId: cellVal(cells[3]),
        author: cellVal(cells[4]),
        lastUpdated: cellVal(cells[5]),
        notes: cellVal(cells[6]),
      })
    }

    return NextResponse.json({ manuals })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? (e as any)?.message : 'Failed to load manuals' },
      { status: 500 }
    )
  }
}
