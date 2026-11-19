import { recordActivation, recordActivationLater } from '@/app/lib/activation'
import { google } from 'googleapis'
import { prisma } from '@/app/lib/db'
import { getGoogleAuth, GOOGLE_SCOPES } from '@/app/lib/google-auth'
import { fetchMemberByDiscordId, fetchMemberIdByDiscordId } from '@/app/lib/sheets/member-repository'
import { getCrewMappings, isClosedStage } from '@/app/lib/crew-mappings'
import { usesDb } from '@/app/lib/sheets-import/source'

/**
 * Claim or give up a crew task: the one implementation behind the crew page's Claim / Give up
 * buttons (POST /api/claim-task) and the Discord /task command. Claiming makes the member the task's
 * lead; only the lead may give it up. Moved out of the route unchanged; `taskId` and `requireOpen`
 * are opt-in additions the web route does not use.
 */
export type ClaimAction = 'claim' | 'giveup'

export interface ClaimInput {
  discordId: string
  action: ClaimAction
  crewId?: string | null
  sheetUrl?: string | null
  taskName?: string | null
  /** Look the task up by its CrewTask id instead of its label (database crews only). */
  taskId?: string | null
  /** Refuse to claim a task in a closed stage (done, skip, ...). The web route sets it too: a task claimed after it was closed must never count for the crew task mission. */
  requireOpen?: boolean
  /**
   * Await the activation write instead of scheduling it. Callers already running inside after()
   * (the Discord command) set this, so the write is not left dangling. The web route leaves it off.
   */
  awaitActivation?: boolean
}

export type ClaimResult =
  | { ok: true; action: ClaimAction; task?: { id: string; label: string; crewId: string } }
  | { ok: false; status: 400 | 403 | 404 | 409 | 500; error: string }

/** Record the first-contribution activation: scheduled with the response, or awaited when asked. */
async function activate(discordId: string, awaitIt?: boolean): Promise<void> {
  if (awaitIt) await recordActivation('first_contribution', { discordId, code: 'task_claim' })
  else recordActivationLater('first_contribution', { discordId, code: 'task_claim' })
}

const fail = (status: 400 | 403 | 404 | 409 | 500, error: string): ClaimResult => ({ ok: false, status, error })

// Google Sheets API client with write access, created on first use so a
// malformed GOOGLE_SERVICE_ACCOUNT_JSON surfaces as a request error rather
// than a module-load crash.
function getSheetsClient() {
  return google.sheets({ version: 'v4', auth: getGoogleAuth([GOOGLE_SCOPES.sheets]) })
}

// Extract sheet ID from Google Sheets URL
function extractSheetId(url: string): string | null {
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/)
  return match ? match[1] : null
}

// Only crew sheets listed in the Crew Mappings config may be written to.
async function getAllowedCrewSheetIds(): Promise<Set<string>> {
  const { crews } = await getCrewMappings()
  const ids = new Set<string>()
  for (const crew of crews) {
    const id = crew.sheet ? extractSheetId(crew.sheet) : null
    if (id) ids.add(id)
  }
  return ids
}

export async function claimCrewTask(input: ClaimInput): Promise<ClaimResult> {
  const { discordId, action } = input
  const sheetUrl = typeof input.sheetUrl === 'string' ? input.sheetUrl : null
  const crewId = typeof input.crewId === 'string' ? input.crewId : null
  const taskName = input.taskName

  // By task id: database crews only; the crew comes from the task row.
  if (input.taskId) {
    const task = await prisma.crewTask.findFirst({
      where: { id: input.taskId, archived: false, ...(crewId ? { crewId: crewId.trim().toLowerCase() } : {}) },
      select: { crewId: true, label: true },
    })
    if (!task) return fail(404, 'Task not found')
    const dbCrew = await findDbTaskCrew(task.crewId, null)
    if (!dbCrew) return fail(404, 'Task not found')
    return claimInDb(discordId, dbCrew, task.label.trim(), action, null, { taskId: input.taskId, requireOpen: input.requireOpen }, input.awaitActivation)
  }

  // Crews whose tasks live in the database (sheets.source.crewTasks): write CrewTask, not the sheet.
  if (typeof taskName === 'string' && taskName.trim()) {
    const dbCrew = await findDbTaskCrew(crewId, sheetUrl)
    if (dbCrew) return claimInDb(discordId, dbCrew, taskName.trim(), action, sheetUrl, input.requireOpen ? { requireOpen: true } : undefined, input.awaitActivation)
  }

  if (typeof sheetUrl !== 'string' || typeof taskName !== 'string' || !sheetUrl || !taskName.trim()) {
    return fail(400, 'Missing required fields')
  }

  const memberId = await fetchMemberIdByDiscordId(discordId)
  if (!memberId) {
    return fail(403, 'No member profile is linked to your Discord account')
  }

  const sheetId = extractSheetId(sheetUrl)
  if (!sheetId) {
    return fail(400, 'Invalid sheet URL')
  }

  const allowedSheetIds = await getAllowedCrewSheetIds()
  if (!allowedSheetIds.has(sheetId)) {
    return fail(403, 'Sheet is not a configured crew sheet')
  }

  // Get the spreadsheet to find the Tasks section
  const res = await getSheetsClient().spreadsheets.get({
    spreadsheetId: sheetId,
    includeGridData: true,
    fields: 'sheets(properties,data(rowData(values(userEnteredValue,formattedValue))))',
  })

  const sheetData = res.data.sheets?.[0]
  if (!sheetData?.data) {
    return fail(500, 'Could not read sheet data')
  }

  // Find the Tasks section and the task row
  let taskRowIdx = -1
  let taskRowCells: Array<{ userEnteredValue?: { stringValue?: string | null; numberValue?: number | null } | null; formattedValue?: string | null }> = []
  let leadColIdx = -1
  let leadIdColIdx = -1
  let tasksHeaderRowIdx = -1

  for (const grid of sheetData.data) {
    const rows = grid.rowData || []

    // Find "Tasks" section header
    for (let r = 0; r < rows.length; r++) {
      const cells = rows[r]?.values || []
      for (let c = 0; c < cells.length; c++) {
        const val = (cells[c]?.userEnteredValue?.stringValue ||
          cells[c]?.formattedValue || '').toLowerCase().trim()
        if (val === 'task' || val === 'tasks') {
          // Check if this is a header row (look for other column headers)
          const rowVals = cells.map(cell =>
            (cell?.userEnteredValue?.stringValue || cell?.formattedValue || '').toLowerCase().trim()
          )
          if (rowVals.includes('lead') || rowVals.includes('stage') || rowVals.includes('priority')) {
            tasksHeaderRowIdx = r

            // Find Lead and Lead ID columns
            for (let ci = 0; ci < cells.length; ci++) {
              const colVal = (cells[ci]?.userEnteredValue?.stringValue ||
                cells[ci]?.formattedValue || '').toLowerCase().trim()
              if (colVal === 'lead') leadColIdx = ci
              if (colVal === 'lead id') leadIdColIdx = ci
            }
            break
          }
        }
      }
      if (tasksHeaderRowIdx !== -1) break
    }

    if (tasksHeaderRowIdx === -1) continue

    // Find the task column index
    const headerCells = rows[tasksHeaderRowIdx]?.values || []
    let taskColIdx = -1
    for (let c = 0; c < headerCells.length; c++) {
      const val = (headerCells[c]?.userEnteredValue?.stringValue ||
        headerCells[c]?.formattedValue || '').toLowerCase().trim()
      if (val === 'task') {
        taskColIdx = c
        break
      }
    }

    if (taskColIdx === -1) continue

    // Find the row with the matching task name
    for (let r = tasksHeaderRowIdx + 1; r < rows.length; r++) {
      const cells = rows[r]?.values || []
      const cellVal = cells[taskColIdx]?.userEnteredValue?.stringValue ||
        cells[taskColIdx]?.formattedValue || ''

      if (cellVal.trim() === taskName.trim()) {
        taskRowIdx = r
        taskRowCells = cells
        break
      }
    }
  }

  if (taskRowIdx === -1) {
    return fail(404, 'Task not found in sheet')
  }

  if (leadColIdx === -1) {
    return fail(500, 'Lead column not found in sheet')
  }

  if (leadIdColIdx === -1) {
    return fail(500, 'Lead ID column not found in sheet')
  }

  // Ownership: read the current Lead ID of the task row.
  const leadIdCellData = taskRowCells[leadIdColIdx]
  const currentLeadId = String(
    leadIdCellData?.userEnteredValue?.stringValue ??
    leadIdCellData?.userEnteredValue?.numberValue ??
    leadIdCellData?.formattedValue ??
    ''
  ).trim()

  if (action === 'giveup' && currentLeadId !== String(memberId)) {
    return fail(403, 'You can only give up tasks you lead')
  }
  if (action === 'claim' && currentLeadId && currentLeadId !== String(memberId)) {
    return fail(409, 'Task is already claimed by another member')
  }

  // Get the sheet name (default to first sheet)
  const sheetName = sheetData.properties?.title || 'Sheet1'

  // Update Lead ID column (write member ID for claim, empty for give-up)
  const leadIdCell = `'${sheetName}'!${columnToLetter(leadIdColIdx)}${taskRowIdx + 1}`
  const newValue = action === 'giveup' ? '' : memberId

  await getSheetsClient().spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: leadIdCell,
    valueInputOption: 'RAW',
    requestBody: {
      values: [[newValue]],
    },
  })

  // Log the claim into TaskClaimEvent so it surfaces in the dashboard
  // activity feed. Idempotent — re-claiming the same task is a no-op.
  // We intentionally don't delete on `giveup`: the historical event is
  // still a true thing that happened.
  if (action === 'claim' && memberId) {
    const taskKey = `${sheetId}::${taskName.trim()}`
    try {
      await prisma.taskClaimEvent.upsert({
        where: { memberId_taskKey: { memberId, taskKey } },
        update: {},
        create: {
          memberId,
          taskKey,
          taskName: taskName.trim(),
          sheetUrl: sheetUrl ?? null,
        },
      })
    } catch (err) {
      // Don't break the user-facing claim flow on a DB hiccup.
      console.error(
        '[claim-task] failed to log TaskClaimEvent (non-blocking):',
        err,
      )
    }
  }

  if (action === 'claim') await activate(discordId, input.awaitActivation)
  return { ok: true, action }
}

// Convert column index (0-based) to letter (A, B, C, ... AA, AB, etc.)
function columnToLetter(col: number): string {
  let letter = ''
  let temp = col
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter
    temp = Math.floor(temp / 26) - 1
  }
  return letter
}

/** The crew (by id, or by its sheet URL) when its tasks read from the database; otherwise null. */
async function findDbTaskCrew(crewId: string | null, sheetUrl: string | null): Promise<{ id: string; sheetId: string | null } | null> {
  const { crews } = await getCrewMappings()
  const sheetId = sheetUrl ? extractSheetId(sheetUrl) : null
  const crew = crewId
    ? crews.find((c) => c.id === crewId.trim().toLowerCase())
    : sheetId
      ? crews.find((c) => (c.sheet ? extractSheetId(c.sheet) : null) === sheetId)
      : undefined
  if (!crew || !(await usesDb('crewTasks', crew.id))) return null
  return { id: crew.id, sheetId: crew.sheet ? extractSheetId(crew.sheet) : null }
}

/**
 * Claim or give up a crew task stored in the database. Same rules as the sheet path: claiming a
 * task someone else leads is refused (409), and only the lead may give a task up (403). The
 * conditional update makes two claims racing for one task safe.
 */
async function claimInDb(
  discordId: string,
  crew: { id: string; sheetId: string | null },
  taskName: string,
  action: ClaimAction,
  sheetUrl: string | null,
  byId?: { taskId?: string; requireOpen?: boolean },
  awaitActivation?: boolean,
): Promise<ClaimResult> {
  const member = await fetchMemberByDiscordId(discordId)
  const memberId = member?.memberId ?? (await fetchMemberIdByDiscordId(discordId))
  if (!memberId) {
    return fail(403, 'No member profile is linked to your Discord account')
  }
  let task: { id: string; label: string; leadMemberId: string | null; stage?: string } | undefined
  if (byId?.taskId) {
    task = (await prisma.crewTask.findFirst({ where: { id: byId.taskId, crewId: crew.id, archived: false }, select: { id: true, label: true, leadMemberId: true, stage: true } })) ?? undefined
  } else {
    const tasks = await prisma.crewTask.findMany({ where: { crewId: crew.id, archived: false }, select: { id: true, label: true, leadMemberId: true, stage: true } })
    task = tasks.find((t) => t.label.trim() === taskName)
  }
  if (!task) return fail(404, 'Task not found')
  if (byId?.requireOpen && action === 'claim' && isClosedStage(task.stage ?? '')) return fail(409, 'That task is closed')

  const current = (task.leadMemberId ?? '').trim()
  if (action === 'giveup') {
    if (current !== String(memberId)) return fail(403, 'You can only give up tasks you lead')
    const r = await prisma.crewTask.updateMany({ where: { id: task.id, leadMemberId: String(memberId) }, data: { leadMemberId: null, leadName: null, updatedBy: discordId } })
    if (r.count === 0) return fail(403, 'You can only give up tasks you lead')
  } else {
    if (current && current !== String(memberId)) return fail(409, 'Task is already claimed by another member')
    const r = await prisma.crewTask.updateMany({
      where: { id: task.id, OR: [{ leadMemberId: null }, { leadMemberId: '' }, { leadMemberId: String(memberId) }] },
      data: { leadMemberId: String(memberId), leadName: member?.name || null, updatedBy: discordId },
    })
    if (r.count === 0) return fail(409, 'Task is already claimed by another member')
  }
  try {
    await prisma.crewTaskEvent.create({ data: { taskId: task.id, crewId: crew.id, action, actor: discordId } })
  } catch (err) {
    console.error('[claim-task] failed to log CrewTaskEvent (non-blocking):', err)
  }

  if (action === 'claim') {
    // Same activity-feed key as the sheet path when the crew still has a sheet, so history lines up.
    const taskKey = crew.sheetId ? `${crew.sheetId}::${taskName}` : `crew:${crew.id}::${taskName}`
    try {
      await prisma.taskClaimEvent.upsert({
        where: { memberId_taskKey: { memberId: String(memberId), taskKey } },
        update: {},
        create: { memberId: String(memberId), taskKey, taskName, sheetUrl: sheetUrl ?? null },
      })
    } catch (err) {
      console.error('[claim-task] failed to log TaskClaimEvent (non-blocking):', err)
    }
    await activate(discordId, awaitActivation)
  }
  return { ok: true, action, task: { id: task.id, label: task.label.trim(), crewId: crew.id } }
}
