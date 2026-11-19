// POST /api/image-review/<slug>/vote { candidateId, vote: "YES"|"NO", comment? } -> { ok: true }. Capos only; upserts.
import { NextResponse } from 'next/server'
import { requireImageReviewer } from '@/app/lib/image-review/access'
import { castVote, parseVote, SLUG_RE } from '@/app/lib/image-review/data'
import { rejectUnsafeWrite } from '@/app/lib/admin-guard'
import { checkKeyedRateLimit, rateLimitResponse } from '@/app/lib/rate-limit'
import { NO_STORE_HEADERS } from '@/app/lib/no-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const auth = await requireImageReviewer()
  if (!auth.ok) return auth.response
  const bad = rejectUnsafeWrite(req)
  if (bad) return bad
  const rl = await checkKeyedRateLimit('image-review-vote', auth.session.discordId)
  if (!rl.success) return rateLimitResponse(rl)
  const { slug } = await ctx.params
  if (!SLUG_RE.test(slug)) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE_HEADERS })
  const body = await req.json().catch(() => null)
  const parsed = parseVote(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400, headers: NO_STORE_HEADERS })
  const saved = await castVote(slug, auth.session.discordId, parsed.value)
  if (!saved) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE_HEADERS })
  return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS })
}
