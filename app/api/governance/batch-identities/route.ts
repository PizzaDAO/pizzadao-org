import { NextResponse } from 'next/server'
import { prisma } from '@/app/lib/db'

// Google Sheet config (same as member-lookup)
const SHEET_ID = '16BBOfasVwz8L6fPMungz_Y0EfF6Z9puskLAix3tCHzM'
const TAB_NAME = 'Crew'

// Admin Discord IDs who can trigger batch operations
const ADMIN_IDS = ['868617172757409822']

function parseGvizJson(text: string) {
  const cleaned = text.replace(/^\s*\/\*O_o\*\/\s*/m, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('GViz: Unexpected response')
  }
  const json = cleaned.slice(start, end + 1)
  return JSON.parse(json)
}

function gvizUrl(sheetId: string, tabName?: string) {
  const url = new URL(`https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq`)
  url.searchParams.set('tqx', 'out:json')
  if (tabName) url.searchParams.set('sheet', tabName)
  url.searchParams.set('headers', '0')
  return url.toString()
}

/**
 * Fetch all Discord IDs from the Crew sheet
 */
async function fetchCrewDiscordIds(): Promise<string[]> {
  const url = gvizUrl(SHEET_ID, TAB_NAME)
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error('Failed to fetch sheet')

  const text = await res.text()
  const gviz = parseGvizJson(text)
  const rows = gviz?.table?.rows || []

  // Find header row
  let headerRowIdx = -1
  let discordColIdx = -1

  for (let ri = 0; ri < Math.min(rows.length, 100); ri++) {
    const rowCells = rows[ri]?.c || []
    const rowVals = rowCells.map((c: any) => String(c?.v || c?.f || '').trim().toLowerCase())

    const hasName = rowVals.includes('name')
    const hasStatus = rowVals.includes('status') || rowVals.includes('frequency')

    if (hasName && hasStatus) {
      headerRowIdx = ri
      // Find discord column
      rowVals.forEach((h: string, ci: number) => {
        const normalized = h.replace(/[#\s\-_]+/g, '')
        if (normalized === 'discordid' || normalized === 'discord') {
          discordColIdx = ci
        }
      })
      break
    }
  }

  if (headerRowIdx === -1 || discordColIdx === -1) {
    throw new Error('Could not find header row or Discord column')
  }

  // Extract all Discord IDs
  const discordIds: string[] = []
  const dataStartIdx = headerRowIdx + 1

  for (let i = dataStartIdx; i < rows.length; i++) {
    const row = rows[i]
    const cellVal = row?.c?.[discordColIdx]?.v ?? row?.c?.[discordColIdx]?.f
    if (cellVal && String(cellVal).trim()) {
      const id = String(cellVal).trim()
      // Validate it looks like a Discord ID (numeric, 17-19 digits)
      if (/^\d{17,19}$/.test(id)) {
        discordIds.push(id)
      }
    }
  }

  return [...new Set(discordIds)] // Remove duplicates
}


/**
 * POST /api/governance/batch-identities
 *
 * Creates Semaphore identities for all crew members with Discord IDs.
 * Admin only endpoint.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { adminDiscordId, dryRun = false, limit } = body

    // Verify admin
    if (!adminDiscordId || !ADMIN_IDS.includes(adminDiscordId)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Fetch all Discord IDs from crew sheet
    console.log('[batch] Fetching crew Discord IDs...')
    let discordIds = await fetchCrewDiscordIds()
    console.log(`[batch] Found ${discordIds.length} Discord IDs in crew sheet`)

    // Apply limit if specified
    if (limit && limit > 0) {
      discordIds = discordIds.slice(0, limit)
    }

    // Get existing identities for stats
    const existing = await prisma.userIdentity.findMany({
      where: { discordId: { in: discordIds } },
      select: { discordId: true }
    })
    const existingIds = new Set(existing.map(e => e.discordId))
    const toCreate = discordIds.filter(id => !existingIds.has(id))

    // Dry run - return stats
    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        totalInSheet: discordIds.length,
        alreadyHaveIdentity: existing.length,
        wouldCreate: toCreate.length,
        sampleIds: toCreate.slice(0, 10),
      })
    }

    // Batch creation is not yet implemented - users create identities on first login
    return NextResponse.json({
      error: 'Batch identity creation is not yet implemented. Users create their identities automatically when they log in via the governance UI.',
      stats: {
        totalInSheet: discordIds.length,
        alreadyHaveIdentity: existing.length,
        needIdentity: toCreate.length,
      }
    }, { status: 501 })

  } catch (err) {
    console.error('[batch] Error:', err)
    return NextResponse.json({
      error: err instanceof Error ? err.message : 'Batch operation failed'
    }, { status: 500 })
  }
}

/**
 * GET /api/governance/batch-identities
 *
 * Returns stats about crew identities
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const adminDiscordId = searchParams.get('adminDiscordId')

    // Verify admin
    if (!adminDiscordId || !ADMIN_IDS.includes(adminDiscordId)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Fetch crew Discord IDs
    const discordIds = await fetchCrewDiscordIds()

    // Check how many have identities
    const identities = await prisma.userIdentity.findMany({
      where: { discordId: { in: discordIds } },
      select: { discordId: true }
    })

    const withIdentity = identities.length
    const withoutIdentity = discordIds.length - withIdentity

    return NextResponse.json({
      totalCrewWithDiscord: discordIds.length,
      withIdentity,
      withoutIdentity,
      percentComplete: Math.round((withIdentity / discordIds.length) * 100),
    })

  } catch (err) {
    console.error('[batch-stats] Error:', err)
    return NextResponse.json({
      error: err instanceof Error ? err.message : 'Failed to get stats'
    }, { status: 500 })
  }
}
