import { NextResponse } from 'next/server'
import { requireCallReviewer } from '@/app/lib/calls/access'
import { setSegmentRedacted } from '@/app/lib/calls/recordings'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { NotFoundError, ValidationError } from '@/app/lib/errors/api-errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const KEY = /^(c:\d{5,25}|s:\d{5,25}:\d{1,10})$/

/**
 * POST /api/admin/calls/[id]/redact-line  { "key": "c:<messageId>", "confirm": true }   hide one transcript line
 *                                         { "key": "...", "restore": true }             undo
 * Dread Pizza Roberts only. Non-destructive (see setSegmentRedacted). Use it for a chat message that
 * was deleted in Discord after the call was ingested, or any line that should not be public.
 */
export const POST = withErrorHandling(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const auth = await requireCallReviewer()
  if (!auth.ok) return auth.response

  const body = (await request.json().catch(() => null)) as { key?: unknown; confirm?: unknown; restore?: unknown } | null
  const restore = body?.restore === true
  if (!restore && body?.confirm !== true) throw new ValidationError('Confirmation required')
  if (typeof body?.key !== 'string' || !KEY.test(body.key)) throw new ValidationError('key must be a transcript line key')

  const { id } = await ctx.params
  if (!(await setSegmentRedacted(id, body.key, !restore))) throw new NotFoundError('Recording line')
  return NextResponse.json({ success: true })
})
