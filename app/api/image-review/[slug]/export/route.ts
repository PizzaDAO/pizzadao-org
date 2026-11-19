// GET /api/image-review/<slug>/export?format=csv|json -> candidates with traits, prompt, yes/no counts and comments, plus the overall set comments. Owner only.
import { NextResponse } from 'next/server'
import { requireImageReviewer } from '@/app/lib/image-review/access'
import { exportCsv, loadExport, SLUG_RE } from '@/app/lib/image-review/data'
import { NO_STORE_HEADERS } from '@/app/lib/no-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const auth = await requireImageReviewer({ ownerOnly: true })
  if (!auth.ok) return auth.response
  const { slug } = await ctx.params
  const data = SLUG_RE.test(slug) ? await loadExport(slug) : null
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE_HEADERS })
  if (new URL(req.url).searchParams.get('format') === 'json') return NextResponse.json(data, { headers: NO_STORE_HEADERS })
  return new NextResponse(exportCsv(data.candidates, data.setComments), {
    headers: { ...NO_STORE_HEADERS, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${slug}-review.csv"` },
  })
}
