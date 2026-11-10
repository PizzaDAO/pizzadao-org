import { NextResponse } from 'next/server'
import { loadSettings } from '@/app/lib/settings'
import { resolveToggle } from '@/app/lib/settings/toggles'
import { computePublicMapLevels } from '@/app/lib/map-levels/service'

export const runtime = 'nodejs'

/**
 * Public reach-map levels for pizzadao.org: a tier per city and country, and a bucketed member
 * count. No names, ids, scores or raw City text (see app/lib/map-levels/aggregate.ts). 404 while
 * the map.levelsEnabled switch is off, so the site falls back to its plain map.
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
} as const

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...CORS, 'Access-Control-Max-Age': '86400' } })
}

export async function GET() {
  try {
    const settings = await loadSettings()
    if (!resolveToggle('map.levelsEnabled', settings)) {
      return NextResponse.json({ enabled: false }, { status: 404, headers: { ...CORS, 'Cache-Control': 'public, s-maxage=300' } })
    }
    const payload = await computePublicMapLevels(settings)
    const maxAge = settings.get('map.cacheSeconds')
    return NextResponse.json(payload, {
      headers: { ...CORS, 'Cache-Control': `public, s-maxage=${maxAge}, stale-while-revalidate=86400` },
    })
  } catch (e) {
    console.error('[map-levels] failed', e instanceof Error ? e.message : e)
    // A short cache keeps the CDN serving its last good copy (stale-while-revalidate) and the site falls back otherwise.
    return NextResponse.json({ error: 'unavailable' }, { status: 503, headers: { ...CORS, 'Cache-Control': 'public, s-maxage=60' } })
  }
}
