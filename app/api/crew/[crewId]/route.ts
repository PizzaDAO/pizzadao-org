import { NextResponse } from 'next/server'
import { getTaskLinks, getTaskLinksDebug, getAgendaStepLinks, getAgendaStepLinksDebug, getMemberTurtlesMap, TaskLinksDebugResult, AgendaLinksDebugResult } from '@/app/api/lib/google-sheets'
import { cacheDel } from '@/app/api/lib/cache'
import { getCrewMappings, type CrewOption } from "@/app/lib/crew-mappings";
import { fetchGviz } from '@/app/lib/sheets/gviz'
import { CREW_SHEET_REVALIDATE_SECONDS, extractSheetId, parseCrewSheetRows, type CrewSheetTask } from '@/app/lib/crew-sheet'
import { internalError } from '@/app/lib/errors/error-response'
import { usesDb } from '@/app/lib/sheets-import/source'
import { crewContentFromDb } from '@/app/lib/crew-content'
import { crewDiscordUrl } from '@/app/lib/crew-discord-link'
import { getGuildChannels } from '@/app/lib/discord-channels'
import { crewRolesFromDb, loadCrewRosterFromDb } from '@/app/lib/crew-roles'

type Params = { params: Promise<{ crewId: string }> }

type CrewSheetData = { roster: any[]; goals: any[]; tasks: any[]; agenda: any[]; callInfo: any }

/** A sheet task as the page gets it (the importer-only fields are left out). */
function pageTask({ sheetRow: _row, dueCell: _due, ...t }: CrewSheetTask) {
  return t
}

/** The crew's Discord channel link (null when the Channel cell cannot be resolved). */
async function resolveDiscordUrl(crew: CrewOption): Promise<string | null> {
  const cell = crew.channel
  if (!cell) return null
  const guildId = process.env.DISCORD_GUILD_ID?.trim()
  // The guild's channel list is only needed to turn a channel name into an id.
  const channels = await getGuildChannels().catch(() => null)
  return crewDiscordUrl(cell, guildId, channels)
}

function crewHeader(crew: CrewOption, withSheet: boolean, discordUrl: string | null = null) {
  return {
    id: crew.id,
    label: crew.label,
    emoji: crew.emoji,
    callTime: crew.callTime,
    callTimeUrl: crew.callTimeUrl,
    callLength: crew.callLength,
    channel: crew.channel,
    role: crew.role,
    ...(discordUrl ? { discordUrl } : {}),
    ...(withSheet ? { sheet: crew.sheet } : {}),
  }
}

/**
 * Read the crew's own sheet: roster, goals, tasks, agenda and call info. Tasks, goals and agenda
 * are replaced from the database below once `sheets.source.crewTasks` covers the crew.
 */
async function readCrewSheet(crew: CrewOption, sheetId: string, forceRefresh: boolean, debugMode: boolean) {
  // Clear task-links and agenda-links caches if force refresh
  if (forceRefresh) {
    await Promise.all([
      cacheDel(`task-links:${sheetId}`),
      cacheDel(`agenda-links:${sheetId}`),
    ])
  }

  // Debug info to track link extraction
  let taskDebugInfo: TaskLinksDebugResult | null = null
  let agendaDebugInfo: AgendaLinksDebugResult | null = null

  // Sheet data comes from Next's data cache (see CREW_SHEET_REVALIDATE_SECONDS) and
  // the hyperlink maps from KV, so parsing on every request is cheap.
  let htmlLinkMap: Record<string, string>
  let agendaLinkMap: Record<string, string>
  if (debugMode) {
    const [taskDebugResult, agendaDebugResult] = await Promise.all([
      getTaskLinksDebug(sheetId),
      getAgendaStepLinksDebug(sheetId),
    ])
    taskDebugInfo = taskDebugResult
    agendaDebugInfo = agendaDebugResult
    htmlLinkMap = taskDebugResult.linkMap
    agendaLinkMap = agendaDebugResult.linkMap
  } else {
    [htmlLinkMap, agendaLinkMap] = await Promise.all([
      getTaskLinks(sheetId),
      getAgendaStepLinks(sheetId),
    ])
  }

  const gviz = await fetchGviz(
    sheetId,
    { headers: 0 },
    forceRefresh ? { fresh: true } : { revalidate: CREW_SHEET_REVALIDATE_SECONDS },
  ).catch(() => {
    throw new Error('Failed to fetch crew spreadsheet')
  })
  const rows = gviz?.table?.rows || []

  const parsed = parseCrewSheetRows(rows, htmlLinkMap, agendaLinkMap)
  const { roster, goals, agenda, callInfo } = parsed
  let tasks: any[] = parsed.tasks.map(pageTask)

  // Use tasks from crew-mappings if sheet parsing didn't find any
  if (tasks.length === 0 && (crew.tasks?.length ?? 0) > 0) {
    tasks = crew.tasks!.map((t: any) => ({
      task: t.label,
      url: t.url,
      priority: '',
      stage: 'now',
      lead: '',
      notes: '',
    }))
  }

  await enrichRosterTurtles(roster)

  const data: CrewSheetData = { roster, goals, tasks, agenda, callInfo }
  return { data, taskDebugInfo, agendaDebugInfo }
}

/** Enrich roster with turtle data from main members database */
async function enrichRosterTurtles(roster: Array<{ name: string; turtles: string }>): Promise<void> {
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
}

export async function GET(req: Request, { params }: Params) {
  const { crewId } = await params

  try {
    // Get crew metadata directly (avoids HTTP fetch which can be blocked by deployment protection)
    const { crews } = await getCrewMappings()

    // Find the crew by ID (case-insensitive)
    const crew = crews.find((c: any) =>
      c.id?.toLowerCase() === crewId.toLowerCase() ||
      c.label?.toLowerCase() === crewId.toLowerCase()
    )

    if (!crew) {
      return NextResponse.json({ error: 'Crew not found' }, { status: 404 })
    }

    const discordUrl = await resolveDiscordUrl(crew)

    const fallbackTasks = (crew.tasks || []).map(t => ({ task: t.label, url: t.url, priority: t.priority || '', stage: 'todo', lead: '', leadId: '', notes: '' }))

    const cacheHeaders = { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800' };

    // Tasks, agenda steps and goals from the database (plans/sheets-cutover.md PR 4).
    const tasksFromDb = await usesDb('crewTasks', crew.id)
    // The roster from the database (plans/sheets-cutover.md PR 5).
    const rolesFromDb = await crewRolesFromDb()
    const withDbContent = async (data: CrewSheetData): Promise<CrewSheetData> => {
      let out = data
      if (tasksFromDb) {
        const content = await crewContentFromDb(crew.id)
        out = {
          ...out,
          tasks: content.tasks,
          goals: content.goals,
          agenda: content.agenda,
          callInfo: out.callInfo ?? (crew.callTime ? { time: crew.callTime, song: '', announcements: '' } : null),
        }
      }
      if (rolesFromDb) {
        const roster = await loadCrewRosterFromDb(crew.id)
        await enrichRosterTurtles(roster)
        out = { ...out, roster }
      }
      return out
    }
    const source = { tasksSource: tasksFromDb ? 'db' : 'sheet', rosterSource: rolesFromDb ? 'db' : 'sheet' }
    const empty: CrewSheetData = { roster: [], goals: [], tasks: fallbackTasks, agenda: [], callInfo: null }

    // If crew has no sheet URL, return just the metadata
    if (!crew.sheet) {
      return NextResponse.json({ crew: crewHeader(crew, false, discordUrl), ...(await withDbContent(empty)), ...source }, { headers: cacheHeaders })
    }

    // Extract sheet ID and fetch data
    const sheetId = extractSheetId(crew.sheet)
    if (!sheetId) {
      return NextResponse.json({
        crew: crewHeader(crew, false, discordUrl),
        ...(await withDbContent(empty)),
        error: 'Invalid sheet URL',
        ...source,
      }, { headers: cacheHeaders })
    }

    // Check for ?fresh=1 to skip cache, ?debug=1 for diagnostics
    const url = new URL(req.url)
    const forceRefresh = url.searchParams.get('fresh') === '1'
    const debugMode = url.searchParams.get('debug') === '1'  // Shows Sheets API diagnostics

    let sheet: Awaited<ReturnType<typeof readCrewSheet>>
    const offSheet = { data: { ...empty, tasks: [] }, taskDebugInfo: null, agendaDebugInfo: null }
    if (tasksFromDb && rolesFromDb) {
      // Nothing on this page comes from the crew sheet any more: do not read it.
      sheet = offSheet
    } else {
      try {
        sheet = await readCrewSheet(crew, sheetId, forceRefresh, debugMode)
      } catch (e) {
        // Once part of the page lives in the database, show it without the sheet part rather
        // than failing.
        if (!tasksFromDb && !rolesFromDb) throw e
        sheet = offSheet
      }
    }
    const { taskDebugInfo, agendaDebugInfo } = sheet

    return NextResponse.json({
      crew: crewHeader(crew, true, discordUrl),
      ...(await withDbContent(sheet.data)),
      ...source,
      ...(taskDebugInfo || agendaDebugInfo ? { _debug: { tasks: taskDebugInfo, agenda: agendaDebugInfo } } : {}),
    }, { headers: cacheHeaders })
  } catch (e: unknown) {
    return internalError(e, 'crew', 'Failed to load crew data')
  }
}
