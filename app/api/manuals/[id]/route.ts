import { NextResponse } from 'next/server'
import { parseGvizJson } from "@/app/lib/gviz-parser"
import { getManualLinks } from '@/app/api/lib/google-sheets'

const MANUALS_SHEET_ID = '1KDAzz8qQubCaFiplWaUFBgCZlHR_mIA0IJHKNqgK5hg'

function norm(s: unknown): string {
  return String(s ?? '').trim().replace(/\s+/g, ' ')
}

function cellVal(cell: any): string {
  return norm(cell?.v ?? cell?.f ?? '')
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

// Extract Google Doc ID from URL
function extractDocId(url: string | null): string | null {
  if (!url) return null
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/)
  return match ? match[1] : null
}

// Clean Google Docs HTML export
function cleanGoogleDocsHtml(html: string): string {
  // Remove everything before <body>
  let cleaned = html.replace(/^[\s\S]*<body[^>]*>/i, '')
  // Remove everything after </body>
  cleaned = cleaned.replace(/<\/body>[\s\S]*$/i, '')
  // Remove <style> tags
  cleaned = cleaned.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
  // Remove <script> tags
  cleaned = cleaned.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
  // Remove inline styles
  cleaned = cleaned.replace(/\s*style="[^"]*"/gi, '')
  // Remove class attributes (Google adds lots of these)
  cleaned = cleaned.replace(/\s*class="[^"]*"/gi, '')
  // Remove id attributes
  cleaned = cleaned.replace(/\s*id="[^"]*"/gi, '')
  // Remove empty spans
  cleaned = cleaned.replace(/<span>\s*<\/span>/gi, '')
  // Clean up whitespace
  cleaned = cleaned.replace(/\n\s*\n/g, '\n')
  return cleaned.trim()
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

    // Fetch spreadsheet data and hyperlinks
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

    // Parse all manuals
    const manuals: Manual[] = []
    for (const row of rows) {
      const cells = row?.c || []
      const title = cellVal(cells[0])
      if (!title) continue

      manuals.push({
        title,
        url: linkMap[title] || null,
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
    const docId = extractDocId(manual.url)

    let content: string | null = null

    if (docId) {
      try {
        // Fetch Google Doc as HTML
        const docUrl = `https://docs.google.com/document/d/${docId}/export?format=html`
        const docRes = await fetch(docUrl, { cache: 'no-store' })

        if (docRes.ok) {
          const rawHtml = await docRes.text()
          content = cleanGoogleDocsHtml(rawHtml)
        }
      } catch (e) {
        // If we can't fetch the doc, just return null content
        console.error('Failed to fetch Google Doc:', e)
      }
    }

    return NextResponse.json({ manual, content })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to load manual' },
      { status: 500 }
    )
  }
}
