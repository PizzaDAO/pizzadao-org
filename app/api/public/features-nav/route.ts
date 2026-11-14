import { NextResponse } from 'next/server'
import { loadSwitches } from '@/app/lib/features/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/public/features-nav
 * Whether the website header should show the features link: only when both the page and the link switch are on.
 * Public, carries one boolean, fails closed.
 */
export async function GET() {
  let enabled = false
  try {
    const s = await loadSwitches()
    enabled = s.publicEnabled && s.navLinkEnabled
  } catch {
    enabled = false
  }
  return NextResponse.json({ enabled }, { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' } })
}
