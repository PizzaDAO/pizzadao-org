import { NextResponse } from 'next/server'
import { requireCallReviewer } from '@/app/lib/calls/access'
import { updateRecordingText } from '@/app/lib/calls/recordings'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { NotFoundError, ValidationError } from '@/app/lib/errors/api-errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** PATCH /api/admin/calls/[id]/summary  { title, summary } — reviewer edits. Dread Pizza Roberts only. */
export const PATCH = withErrorHandling(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const auth = await requireCallReviewer()
  if (!auth.ok) return auth.response

  const body = (await request.json().catch(() => null)) as { title?: unknown; summary?: unknown } | null
  const field = (v: unknown, name: string, max: number): string | null => {
    if (v === null || v === undefined) return null
    if (typeof v !== 'string' || v.length > max) throw new ValidationError(`${name} must be a string up to ${max} characters`)
    return v.trim() || null
  }
  const title = field(body?.title, 'title', 200)
  const summary = field(body?.summary, 'summary', 20000)

  const { id } = await ctx.params
  if (!(await updateRecordingText(id, { title, summary }))) throw new NotFoundError('Recording')
  return NextResponse.json({ success: true })
})
