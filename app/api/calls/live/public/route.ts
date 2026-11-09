import { NextResponse } from 'next/server'
import { loadSettings } from '@/app/lib/settings'
import { publicLiveView } from '@/app/lib/calls/live-view'
import { withErrorHandling } from '@/app/lib/errors/error-response'

export const runtime = 'nodejs'

/**
 * GET /api/calls/live/public: the calls that are live, each with title, crew, start time, stream link
 * and head count. No names. Cached at the CDN for ~5 s so signed-out traffic never reaches the
 * database. Any failure says "nothing live" (and is not cached for long).
 */
export const GET = withErrorHandling(async () => {
  try {
    const out = await publicLiveView(await loadSettings())
    return NextResponse.json(out, { headers: { 'Cache-Control': 'public, s-maxage=5, stale-while-revalidate=10' } })
  } catch {
    return NextResponse.json({ calls: [], pollSeconds: 10 }, { headers: { 'Cache-Control': 'public, s-maxage=5' } })
  }
})
