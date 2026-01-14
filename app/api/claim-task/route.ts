import { NextResponse } from 'next/server'
import { google } from 'googleapis'
import path from 'path'

// Initialize Google Sheets API client with write access
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets']

let credentials
try {
  credentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
    ? JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
    : undefined
} catch (error) {
}

const auth = new google.auth.GoogleAuth({
  credentials,
  keyFile: !credentials ? path.join(process.cwd(), 'service-account.json') : undefined,
  scopes: SCOPES,
})

const sheets = google.sheets({ version: 'v4', auth })

// Extract sheet ID from Google Sheets URL
function extractSheetId(url: string): string | null {
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/)
  return match ? match[1] : null
}

export async function POST(req: Request) {
  try {
    const { sheetUrl, taskName, memberId, action = 'claim' } = await req.json()

    if (!sheetUrl || !taskName) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    if (action === 'claim' && !memberId) {
      return NextResponse.json(
        { error: 'Member ID required to claim task' },
        { status: 400 }
      )
    }

    const sheetId = extractSheetId(sheetUrl)
    if (!sheetId) {
      return NextResponse.json(
        { error: 'Invalid sheet URL' },
        { status: 400 }
      )
    }

    // Get the spreadsheet to find the Tasks section
    const res = await sheets.spreadsheets.get({
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

    // Get the sheet name (default to first sheet)
    const sheetName = sheetData.properties?.title || 'Sheet1'

    // Update Lead ID column (write member ID for claim, empty for give-up)
    const leadIdCell = `'${sheetName}'!${columnToLetter(leadIdColIdx)}${taskRowIdx + 1}`
    const newValue = action === 'giveup' ? '' : memberId

    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: leadIdCell,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[newValue]],
      },
    })

    return NextResponse.json({ success: true, action })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? (e as any)?.message : 'Failed to claim task' },
      { status: 500 }
    )
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
