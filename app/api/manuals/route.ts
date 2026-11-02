import { fetchGviz, type GvizCacheOptions } from "@/app/lib/sheets/gviz";
import { SHEET_IDS } from "@/app/lib/sheets/config";
import { isTablesModeDetected } from "@/app/lib/table-parser";
import { listManualsFromDb, manualsFromDb, parseManualsTable, type Manual } from "@/app/lib/manuals";
import { NextResponse } from 'next/server'
import { getManualLinks, getManualLinksDebug, ManualLinksDebugResult } from '@/app/api/lib/google-sheets'
import { cacheDel } from '@/app/api/lib/cache'
import { GvizTable } from "@/app/lib/types/gviz";

export type { Manual }
import { internalError } from "@/app/lib/errors/error-response";

const MANUALS_SHEET_ID = SHEET_IDS.manuals

/** Read-only config sheet: 5-minute data cache unless ?fresh=1. */
const MANUALS_REVALIDATE_SECONDS = 300

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const crewFilter = url.searchParams.get('crew')?.toLowerCase()
    const debugMode = url.searchParams.get('debug') === '1'
    const forceRefresh = url.searchParams.get('fresh') === '1'

    // Once the index lives in the database (sheets.source.manuals = db), the sheet is not read.
    if (await manualsFromDb()) {
      const allManuals = await listManualsFromDb()
      const manuals = crewFilter ? allManuals.filter(m => m.crew.toLowerCase() === crewFilter) : allManuals
      return NextResponse.json({ manuals }, {
        headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600' }
      })
    }

    // Clear cache if force refresh
    if (forceRefresh) {
      await cacheDel(`manual-links:${MANUALS_SHEET_ID}`)
    }

    // Fetch spreadsheet data via GViz API and hyperlinks via Sheets API in parallel
    // Note: headers=1 tells GViz to treat first row as headers (but Tables mode ignores this)
    const cacheOpts: GvizCacheOptions = forceRefresh
      ? { fresh: true }
      : { revalidate: MANUALS_REVALIDATE_SECONDS }
    const loadManualsSheet = () =>
      fetchGviz(MANUALS_SHEET_ID, { headers: 1 }, cacheOpts).catch(() => {
        throw new Error('Failed to fetch manuals spreadsheet')
      })

    // Use debug version when debug mode is enabled
    let linkMap: Record<string, string>
    let debugInfo: ManualLinksDebugResult | null = null

    if (debugMode) {
      const [gviz, debugResult] = await Promise.all([
        loadManualsSheet(),
        getManualLinksDebug(MANUALS_SHEET_ID),
      ])
      debugInfo = debugResult
      linkMap = debugResult.linkMap

      const table = gviz?.table as GvizTable

      if (!table) {
        throw new Error('No table data in GViz response')
      }

      // Parse manuals using the robust table parser
      const allManuals = parseManualsTable(table, linkMap)

      // Apply crew filter if specified
      const manuals = crewFilter
        ? allManuals.filter(m => m.crew.toLowerCase() === crewFilter)
        : allManuals

      return NextResponse.json({ manuals, _debug: debugInfo }, {
        headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' }
      })
    }

    const [gviz, linkMapResult] = await Promise.all([
      loadManualsSheet(),
      getManualLinks(MANUALS_SHEET_ID),
    ])
    linkMap = linkMapResult

    const table = gviz?.table as GvizTable

    if (!table) {
      throw new Error('No table data in GViz response')
    }

    // Check if we're in Tables mode (for logging/debugging)
    // Note: isTablesModeDetected is called internally by parseTable
    void isTablesModeDetected(table) // Explicit acknowledgment for debugging

    // Parse manuals using the robust table parser
    // This handles:
    // - Dynamic header row detection
    // - Tables mode (concatenated column labels)
    // - Various column naming conventions
    const allManuals = parseManualsTable(table, linkMap)

    // Apply crew filter if specified
    const manuals = crewFilter
      ? allManuals.filter(m => m.crew.toLowerCase() === crewFilter)
      : allManuals

    return NextResponse.json({ manuals }, {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' }
    })
  } catch (e: unknown) {
    return internalError(e, 'manuals', 'Failed to load manuals')
  }
}
