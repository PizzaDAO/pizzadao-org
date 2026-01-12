import { NextResponse } from 'next/server'
import { getTaskLinks, getAgendaStepLinks, getMemberTurtlesMap } from '@/app/api/lib/google-sheets'
import { getCachedSheetData, setCachedSheetData } from '@/app/api/lib/sheet-cache'

type Params = { params: Promise<{ crewId: string }> }

// Helper to normalize strings
function norm(s: unknown): string {
  return String(s ?? '').trim().replace(/\s+/g, ' ')
}

// Extract sheet ID from Google Sheets URL
function extractSheetId(url: string): string | null {
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/)
  return match ? match[1] : null
}

// Parse GViz JSON response
function parseGvizJson(text: string) {
  const cleaned = text.replace(/^\s*\/\*O_o\*\/\s*/m, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('GViz: Unexpected response')
  }
  return JSON.parse(cleaned.slice(start, end + 1))
}

// Get cell value
function cellVal(cell: any): string {
  return norm(cell?.v ?? cell?.f ?? '')
}

// Extract URL from cell (checks GViz link property, hyperlink, or text content)
function extractUrl(cell: any): string | null {
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

// Detect section by checking if row contains specific headers
function detectSection(rowVals: string[]): string | null {
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
function parseRoster(rows: any[], headerIdx: number, headers: string[]) {
  const headerMap = new Map<string, number>()
  headers.forEach((h, i) => headerMap.set(h.toLowerCase(), i))

  const roster: any[] = []

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

// Parse goals section
function parseGoals(rows: any[], headerIdx: number, headers: string[]) {
  const headerMap = new Map<string, number>()
  headers.forEach((h, i) => headerMap.set(h.toLowerCase(), i))

  const goals: any[] = []
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
function parseTasks(rows: any[], headerIdx: number, headers: string[], htmlLinkMap: Record<string, string> = {}) {
  const headerMap = new Map<string, number>()
  headers.forEach((h, i) => headerMap.set(h.toLowerCase(), i))

  const tasks: any[] = []
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
      task,
      url,
      dueDate: cellVal(cells[headerMap.get('due') ?? headerMap.get('due date') ?? headerMap.get('duedate') ?? -1]),
      lead: cellVal(cells[headerMap.get('lead') ?? headerMap.get('owner') ?? headerMap.get('assigned') ?? -1]),
      leadId: cellVal(cells[headerMap.get('lead id') ?? -1]),
      notes: cellVal(cells[headerMap.get('notes') ?? -1]),
    })
  }

  return tasks
}

// Parse agenda section
function parseAgenda(rows: any[], headerIdx: number, headers: string[], htmlLinkMap: Record<string, string> = {}) {
  const headerMap = new Map<string, number>()
  headers.forEach((h, i) => headerMap.set(h.toLowerCase(), i))

  const agenda: any[] = []
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

export async function GET(req: Request, { params }: Params) {
  const { crewId } = await params

  try {
    // Get crew metadata from crew-mappings
    const baseUrl = req.headers.get('x-forwarded-host')
      ? `${req.headers.get('x-forwarded-proto') || 'https'}://${req.headers.get('x-forwarded-host')}`
      : `http://${req.headers.get('host')}`

    const mappingsRes = await fetch(`${baseUrl}/api/crew-mappings`, { cache: 'no-store' })
    if (!mappingsRes.ok) {
      throw new Error('Failed to fetch crew mappings')
    }

    const mappingsData = await mappingsRes.json()
    const crews = mappingsData.crews || []

    // Find the crew by ID (case-insensitive)
    const crew = crews.find((c: any) =>
      c.id?.toLowerCase() === crewId.toLowerCase() ||
      c.label?.toLowerCase() === crewId.toLowerCase()
    )

    if (!crew) {
      return NextResponse.json({ error: 'Crew not found' }, { status: 404 })
    }

    // If crew has no sheet URL, return just the metadata
    if (!crew.sheet) {
      return NextResponse.json({
        crew: {
          id: crew.id,
          label: crew.label,
          emoji: crew.emoji,
          callTime: crew.callTime,
          callTimeUrl: crew.callTimeUrl,
          callLength: crew.callLength,
          channel: crew.channel,
          role: crew.role,
        },
        roster: [],
        goals: [],
        tasks: crew.tasks || [],
        agenda: [],
        callInfo: null,
      })
    }

    // Extract sheet ID and fetch data
    const sheetId = extractSheetId(crew.sheet)
    if (!sheetId) {
      return NextResponse.json({
        crew: {
          id: crew.id,
          label: crew.label,
          emoji: crew.emoji,
          callTime: crew.callTime,
          callTimeUrl: crew.callTimeUrl,
          callLength: crew.callLength,
          channel: crew.channel,
          role: crew.role,
        },
        roster: [],
        goals: [],
        tasks: crew.tasks || [],
        agenda: [],
        callInfo: null,
        error: 'Invalid sheet URL',
      })
    }

    // Check for ?fresh=1 to skip cache
    const url = new URL(req.url)
    const forceRefresh = url.searchParams.get('fresh') === '1'

    // Try to get cached data first (unless force refresh)
    type CrewSheetData = { roster: any[]; goals: any[]; tasks: any[]; agenda: any[]; callInfo: any }
    let sheetData: CrewSheetData | null = null

    if (!forceRefresh) {
      sheetData = await getCachedSheetData<CrewSheetData>(crew.sheet)
      if (sheetData) {
        console.log(`[crew] Cache hit for ${crewId}`)
      }
    }

    // If no cached data, fetch fresh
    if (!sheetData) {
      console.log(`[crew] Cache miss for ${crewId}, fetching fresh data`)

      // Fetch spreadsheet data via GViz API and HTML links in parallel
      const gvizUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&headers=0`
      const [sheetRes, htmlLinkMap, agendaLinkMap] = await Promise.all([
        fetch(gvizUrl, { cache: 'no-store' }),
        getTaskLinks(sheetId),
        getAgendaStepLinks(sheetId),
      ])
      if (!sheetRes.ok) {
        throw new Error('Failed to fetch crew spreadsheet')
      }

      const text = await sheetRes.text()
      const gviz = parseGvizJson(text)
      const rows = gviz?.table?.rows || []

      // Parse sections by detecting header rows
      let roster: any[] = []
      let goals: any[] = []
      let tasks: any[] = []
      let agenda: any[] = []
      let callInfo: any = null

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

      // Use tasks from crew-mappings if sheet parsing didn't find any
      if (tasks.length === 0 && crew.tasks?.length > 0) {
        tasks = crew.tasks.map((t: any) => ({
          task: t.label,
          url: t.url,
          priority: '',
          stage: 'now',
          lead: '',
          notes: '',
        }))
      }

      // Enrich roster with turtle data from main members database
      const turtlesMap = await getMemberTurtlesMap()
      for (const member of roster) {
        if (!member.turtles && member.name) {
          const normalizedName = member.name.toLowerCase().replace(/\s+/g, ' ')
          const turtles = turtlesMap.get(normalizedName)
          if (turtles) {
            member.turtles = turtles
          }
        }
      }

      sheetData = { roster, goals, tasks, agenda, callInfo }

      // Cache the parsed data
      await setCachedSheetData(crew.sheet, sheetData)
    }

    return NextResponse.json({
      crew: {
        id: crew.id,
        label: crew.label,
        emoji: crew.emoji,
        callTime: crew.callTime,
        callTimeUrl: crew.callTimeUrl,
        callLength: crew.callLength,
        channel: crew.channel,
        role: crew.role,
        sheet: crew.sheet,
      },
      ...sheetData,
    })
  } catch (e: unknown) {
    console.error('[crew] Error:', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to load crew data' },
      { status: 500 }
    )
  }
}
