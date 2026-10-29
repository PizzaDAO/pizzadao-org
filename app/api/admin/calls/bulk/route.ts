import { NextResponse } from 'next/server'
import { requireCallReviewer } from '@/app/lib/calls/access'
import { bulkActionMax, bulkReview } from '@/app/lib/calls/bulk'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { ValidationError } from '@/app/lib/errors/api-errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ID = /^[A-Za-z0-9_-]{8,40}$/

/**
 * POST /api/admin/calls/bulk  { "action": "publish" | "reject", "ids": ["..."], "confirm": true }
 * Dread Pizza Roberts only. Imported (non-Discord) calls only, at most calls.bulkActionMax ids (50 at the most).
 * Every id goes through the single-call publish gate / reject, so an incomplete call is reported, not forced.
 * Bulk publish never posts a Discord recap. Responds with a result per id.
 */
export const POST = withErrorHandling(async (request: Request) => {
  const auth = await requireCallReviewer()
  if (!auth.ok) return auth.response

  const body = (await request.json().catch(() => null)) as { action?: unknown; ids?: unknown; confirm?: unknown } | null
  if (body?.action !== 'publish' && body?.action !== 'reject') throw new ValidationError('action must be "publish" or "reject"')
  if (body.confirm !== true) throw new ValidationError('Confirmation required')
  if (!Array.isArray(body.ids) || body.ids.length === 0) throw new ValidationError('ids must be a non-empty array')
  const ids = body.ids
  if (!ids.every((v): v is string => typeof v === 'string' && ID.test(v))) throw new ValidationError('ids must be recording ids')
  const max = await bulkActionMax()
  if (new Set(ids).size > max) throw new ValidationError(`At most ${max} calls per click`)

  const results = await bulkReview(body.action, ids, auth.session.discordId)
  const counts: Record<string, number> = {}
  for (const r of results) counts[r.result] = (counts[r.result] ?? 0) + 1
  return NextResponse.json({ success: true, results, counts, max })
})
