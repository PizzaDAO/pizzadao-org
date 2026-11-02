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

// ---------------------------------------------------------------------------
// Crew page sections (moved from /api/crew/[crewId] so the importer shares them)
// ---------------------------------------------------------------------------

export type CrewSheetGoal = { priority: string; description: string }
export type CrewSheetTask = {
  priority: string
  stage: string
  goal: string
  task: string
  url: string | null
  dueDate: string
  lead: string
  leadId: string
  notes: string
  /** 1-based sheet row (headers=0 GViz rows). */
  sheetRow?: number
  /** The raw Due cell, for an exact ISO date. */
  dueCell?: { v?: unknown; f?: unknown }
}
export type CrewSheetAgendaStep = { time: string; lead: string; step: string; stepUrl: string | null; action: string; notes: string }
export type CrewSheetCallInfo = { time: string; song: string; announcements: string }

// Extract URL from cell (checks GViz link property, hyperlink, or text content)
export function extractUrl(cell: any): string | null {
  if (!cell) return null

  // Check for GViz link property (how GViz returns hyperlinks)
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

// Parse goals section
export function parseGoals(rows: any[], headerIdx: number, headers: string[]) {
  const headerMap = new Map<string, number>()
  headers.forEach((h, i) => headerMap.set(h.toLowerCase(), i))

  const goals: CrewSheetGoal[] = []
  const seen = new Set<string>() // Deduplicate by description
  const goalIdx = headerMap.get('goal') ?? headerMap.get('goals') ?? -1
  const priorityIdx = headerMap.get('priority') ?? -1

  for (let ri = headerIdx + 1; ri < rows.length; ri++) {
    const cells = rows[ri]?.c || []
    const goal = cellVal(cells[goalIdx])
    if (!goal) continue

    // Check if we hit another section header
    const rowVals = cells.map(cellVal)
    if (detectSection(rowVals)) break

    // Skip duplicates
    const key = goal.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    goals.push({
      priority: cellVal(cells[priorityIdx]),
      description: goal,
    })
  }

  return goals
}

// Parse tasks section
export function parseTasks(rows: any[], headerIdx: number, headers: string[], htmlLinkMap: Record<string, string> = {}) {
  const headerMap = new Map<string, number>()
  headers.forEach((h, i) => headerMap.set(h.toLowerCase(), i))

  const tasks: CrewSheetTask[] = []
  const taskIdx = headerMap.get('task') ?? -1

  for (let ri = headerIdx + 1; ri < rows.length; ri++) {
    const cells = rows[ri]?.c || []
    const taskCell = cells[taskIdx]
    const task = cellVal(taskCell)
    if (!task) continue

    // Check if we hit another section header
    const rowVals = cells.map(cellVal)
    if (detectSection(rowVals)) break

    // Priority: 1. HTML link map (Ctrl+K links)  2. GViz/text extraction
    const url = htmlLinkMap[task] || extractUrl(taskCell)

    tasks.push({
      priority: cellVal(cells[headerMap.get('priority') ?? -1]),
      stage: cellVal(cells[headerMap.get('stage') ?? -1]),
      goal: cellVal(cells[headerMap.get('goal') ?? -1]),
      task,
      url,
      dueDate: cellVal(cells[headerMap.get('due') ?? headerMap.get('due date') ?? headerMap.get('duedate') ?? -1]),
      lead: cellVal(cells[headerMap.get('lead') ?? headerMap.get('owner') ?? headerMap.get('assigned') ?? -1]),
      leadId: cellVal(cells[headerMap.get('lead id') ?? -1]),
      notes: cellVal(cells[headerMap.get('notes') ?? -1]),
      sheetRow: ri + 1,
      dueCell: cells[headerMap.get('due') ?? headerMap.get('due date') ?? headerMap.get('duedate') ?? -1] ?? undefined,
    })
  }

  return tasks
}

// Parse agenda section
export function parseAgenda(rows: any[], headerIdx: number, headers: string[], htmlLinkMap: Record<string, string> = {}) {
  const headerMap = new Map<string, number>()
  headers.forEach((h, i) => headerMap.set(h.toLowerCase(), i))

  const agenda: CrewSheetAgendaStep[] = []
  const stepIdx = headerMap.get('step') ?? -1

  for (let ri = headerIdx + 1; ri < rows.length; ri++) {
    const cells = rows[ri]?.c || []
    const stepCell = cells[stepIdx]
    const step = cellVal(stepCell)
    const action = cellVal(cells[headerMap.get('action') ?? -1])
    if (!step && !action) continue

    // Check if we hit another section header
    const rowVals = cells.map(cellVal)
    if (detectSection(rowVals)) break

    // Extract URL from step cell (check HTML link map first, then GViz extraction)
    const stepUrl = htmlLinkMap[step] || extractUrl(stepCell)

    agenda.push({
      time: cellVal(cells[headerMap.get('time') ?? -1]),
      lead: cellVal(cells[headerMap.get('lead') ?? -1]),
      step,
      stepUrl,
      action,
      notes: cellVal(cells[headerMap.get('notes') ?? -1]),
    })
  }

  return agenda
}

/** Every section of a crew sheet (GViz headers=0 rows), as the crew page shows them. Pure. */
export function parseCrewSheetRows(
  rows: any[],
  htmlLinkMap: Record<string, string> = {},
  agendaLinkMap: Record<string, string> = {},
): { roster: RosterRow[]; goals: CrewSheetGoal[]; tasks: CrewSheetTask[]; agenda: CrewSheetAgendaStep[]; callInfo: CrewSheetCallInfo | null } {
  let roster: RosterRow[] = []
  let goals: CrewSheetGoal[] = []
  let tasks: CrewSheetTask[] = []
  let agenda: CrewSheetAgendaStep[] = []
  let callInfo: CrewSheetCallInfo | null = null

  for (let ri = 0; ri < rows.length; ri++) {
    const cells = rows[ri]?.c || []
    const rowVals = cells.map(cellVal)
    const section = detectSection(rowVals)

    if (section === 'roster') {
      roster = parseRoster(rows, ri, rowVals)
    } else if (section === 'goals') {
      goals = parseGoals(rows, ri, rowVals)
    } else if (section === 'tasks') {
      tasks = parseTasks(rows, ri, rowVals, htmlLinkMap)
    } else if (section === 'agenda') {
      agenda = parseAgenda(rows, ri, rowVals, agendaLinkMap)
    }

    // Look for call time in early rows
    if (ri < 10 && !callInfo) {
      const firstCell = rowVals[0]?.toLowerCase() || ''
      if (firstCell.includes('call time') || firstCell.includes('meeting time')) {
        callInfo = {
          time: rowVals[1] || '',
          song: '',
          announcements: '',
        }
      }
    }
  }
  return { roster, goals, tasks, agenda, callInfo }
}
