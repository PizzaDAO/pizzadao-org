// Crew sheet parsing helpers shared by /api/crew/[crewId] and the crew-lead
// permission check (app/lib/crew-leads.ts). Moved verbatim out of the route
// (jalapeno-82565) so the two can't drift.
import { norm } from '@/app/lib/strings'
import { fetchGviz } from '@/app/lib/sheets/gviz'

/**
 * Crew sheets are edited during calls, so they get a shorter data-cache window
 * than config sheets. The response itself is also CDN-cached (s-maxage=300).
 * ?fresh=1 bypasses the data cache.
 */
export const CREW_SHEET_REVALIDATE_SECONDS = 60

export type RosterRow = {
  id: string
  status: string
  name: string
  city: string
  org: string
  skills: string
  turtles: string
  telegram: string
  attendance: string
  notes: string
}

// Extract sheet ID from Google Sheets URL
export function extractSheetId(url: string): string | null {
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/)
  return match ? match[1] : null
}

// Get cell value
export function cellVal(cell: any): string {
  return norm(cell?.v ?? cell?.f ?? '')
}

// Detect section by checking if row contains specific headers
export function detectSection(rowVals: string[]): string | null {
  const lower = rowVals.map(v => v.toLowerCase())

  // Roster section: has "name" and "status" or "city"
  if (lower.includes('name') && (lower.includes('status') || lower.includes('city'))) {
    return 'roster'
  }

  // Tasks section: has "task" column (check before goals since tasks may also have "goal" column)
  if (lower.includes('task')) {
    return 'tasks'
  }

  // Goals section: has "goal" as a header but NOT "task"
  if (lower.includes('goal') && !lower.includes('task')) {
    return 'goals'
  }

  // Agenda section: has "step" and "action" or "lead"
  if (lower.includes('step') && (lower.includes('action') || lower.includes('lead'))) {
    return 'agenda'
  }

  return null
}

// Parse roster section
export function parseRoster(rows: any[], headerIdx: number, headers: string[]): RosterRow[] {
  const headerMap = new Map<string, number>()
  headers.forEach((h, i) => headerMap.set(h.toLowerCase(), i))

  const roster: RosterRow[] = []

  for (let ri = headerIdx + 1; ri < rows.length; ri++) {
    const cells = rows[ri]?.c || []
    const name = cellVal(cells[headerMap.get('name') ?? -1])
    if (!name) continue // Skip empty rows

    // Check if we hit another section header
    const rowVals = cells.map(cellVal)
    if (detectSection(rowVals)) break

    roster.push({
      id: cellVal(cells[headerMap.get('id') ?? headerMap.get('#') ?? -1]),
      status: cellVal(cells[headerMap.get('status') ?? -1]),
      name,
      city: cellVal(cells[headerMap.get('city') ?? -1]),
      org: cellVal(cells[headerMap.get('org') ?? headerMap.get('organization') ?? headerMap.get('orgs') ?? -1]),
      skills: cellVal(cells[headerMap.get('skills') ?? headerMap.get('specialties') ?? -1]),
      turtles: cellVal(cells[headerMap.get('turtles') ?? headerMap.get('turtle') ?? headerMap.get('roles') ?? -1]),
      telegram: cellVal(cells[headerMap.get('telegram') ?? -1]),
      attendance: cellVal(cells[headerMap.get('attendance') ?? headerMap.get('att') ?? -1]),
      notes: cellVal(cells[headerMap.get('notes') ?? -1]),
    })
  }

  return roster
}

/** Read a crew's roster from its sheet (same data-cache window as the crew route). */
export async function fetchCrewRoster(sheetUrl: string, revalidate: number): Promise<RosterRow[]> {
  const sheetId = extractSheetId(sheetUrl)
  if (!sheetId) return []
  const gviz = await fetchGviz(sheetId, { headers: 0 }, { revalidate })
  const rows = gviz?.table?.rows || []
  let roster: RosterRow[] = []
  for (let ri = 0; ri < rows.length; ri++) {
    const rowVals = (rows[ri]?.c || []).map(cellVal)
    if (detectSection(rowVals) === 'roster') roster = parseRoster(rows, ri, rowVals)
  }
  return roster
}
