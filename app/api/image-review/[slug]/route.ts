// GET /api/image-review/<slug> -> the set, its candidates, tallies, the viewer's votes and everyone's comments. Capos, Dread Pizza Roberts and members at the minimum level.
import { NextResponse } from 'next/server'
import { requireImageReviewer } from '@/app/lib/image-review/access'
import { loadSet, SLUG_RE } from '@/app/lib/image-review/data'
import { NO_STORE_HEADERS } from '@/app/lib/no-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const auth = await requireImageReviewer()
  if (!auth.ok) return auth.response
  const { slug } = await ctx.params
  if (!SLUG_RE.test(slug)) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE_HEADERS })
  const set = await loadSet(slug, auth.session.discordId)
  if (!set) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE_HEADERS })
  return NextResponse.json(set, { headers: NO_STORE_HEADERS })
}
