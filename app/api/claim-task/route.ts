import { NextResponse } from 'next/server'
import { google } from 'googleapis'
import { prisma } from '@/app/lib/db'
import { getGoogleAuth, GOOGLE_SCOPES } from '@/app/lib/google-auth'
import { requireSession } from '@/app/lib/auth-guards'
import { fetchMemberIdByDiscordId } from '@/app/lib/sheets/member-repository'
import { getCrewMappings } from '@/app/lib/crew-mappings'
import { internalError } from '@/app/lib/errors/error-response'

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

export async function POST(req: Request) {
  const auth = await requireSession()
  if (!auth.ok) return auth.response

  try {
    // memberId in the body is ignored: it is always derived from the session.
    const { sheetUrl, taskName, action = 'claim' } = await req.json()

    if (typeof sheetUrl !== 'string' || typeof taskName !== 'string' || !sheetUrl || !taskName.trim()) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    if (action !== 'claim' && action !== 'giveup') {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    const memberId = await fetchMemberIdByDiscordId(auth.session.discordId)
    if (!memberId) {
      return NextResponse.json(
        { error: 'No member profile is linked to your Discord account' },
        { status: 403 }
      )
    }

    const sheetId = extractSheetId(sheetUrl)
    if (!sheetId) {
      return NextResponse.json(
        { error: 'Invalid sheet URL' },
        { status: 400 }
      )
    }

    const allowedSheetIds = await getAllowedCrewSheetIds()
    if (!allowedSheetIds.has(sheetId)) {
      return NextResponse.json(
        { error: 'Sheet is not a configured crew sheet' },
        { status: 403 }
      )
    }

    // Get the spreadsheet to find the Tasks section
    const res = await getSheetsClient().spreadsheets.get({
      spreadsheetId: sheetId,
      includeGridData: true,
      fields: 'sheets(properties,data(rowData(values(userEnteredValue,formattedValue))))',
    })

    const sheetData = res.data.sheets?.[0]
    if (!sheetData?.data) {
      return NextResponse.json(
        { error: 'Could not read sheet data' },
        { status: 500 }
      )
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
      return NextResponse.json(
        { error: 'Task not found in sheet' },
        { status: 404 }
      )
    }

    if (leadColIdx === -1) {
      return NextResponse.json(
        { error: 'Lead column not found in sheet' },
        { status: 500 }
      )
    }

    if (leadIdColIdx === -1) {
      return NextResponse.json(
        { error: 'Lead ID column not found in sheet' },
        { status: 500 }
      )
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
      return NextResponse.json(
        { error: 'You can only give up tasks you lead' },
        { status: 403 }
      )
    }
    if (action === 'claim' && currentLeadId && currentLeadId !== String(memberId)) {
      return NextResponse.json(
        { error: 'Task is already claimed by another member' },
        { status: 409 }
      )
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

    return NextResponse.json({ success: true, action })
  } catch (e: unknown) {
    return internalError(e, 'claim-task', 'Failed to claim task')
  }
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
