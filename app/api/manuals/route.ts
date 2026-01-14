import { parseGvizJson } from "@/app/lib/gviz-parser";
import { NextResponse } from 'next/server'
import { getManualLinks } from '@/app/api/lib/google-sheets'

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

    // Fetch spreadsheet data via GViz API and hyperlinks via Sheets API in parallel
    const gvizUrl = `https://docs.google.com/spreadsheets/d/${MANUALS_SHEET_ID}/gviz/tq?tqx=out:json&headers=1`
    const [sheetRes, linkMap] = await Promise.all([
      fetch(gvizUrl, { cache: 'no-store' }),
      getManualLinks(MANUALS_SHEET_ID),
    ])

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
      { error: e instanceof Error ? e.message : 'Failed to load manuals' },
      { status: 500 }
    )
  }
}
