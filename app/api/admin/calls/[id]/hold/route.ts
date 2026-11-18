import { NextResponse } from 'next/server'
import { requireCallAccess } from '@/app/lib/calls/access'
import { HOLD_NOTE_MAX, releaseHold, setHold } from '@/app/lib/calls/hold'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { ConflictError, NotFoundError, ValidationError } from '@/app/lib/errors/api-errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/calls/[id]/hold  { "action": "hold", "note"?: string }   put a call on hold for the owner
 *                                  { "action": "release" }                  release it
 * A Pizza Capo (while calls.capoReviewEnabled is on) may only hold; Dread Pizza Roberts may do both.
 * A held call is hidden from capos and only the owner can publish it. The note is private.
 */
export const POST = withErrorHandling(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params
  const body = (await request.json().catch(() => null)) as { action?: unknown; note?: unknown } | null
  if (body?.action !== 'hold' && body?.action !== 'release') throw new ValidationError('action must be "hold" or "release"')
  const auth = await requireCallAccess(id, body.action === 'hold' ? 'hold' : 'releaseHold')
  if (!auth.ok) return auth.response

  if (body.action === 'hold') {
    if (body.note !== undefined && body.note !== null && (typeof body.note !== 'string' || body.note.length > HOLD_NOTE_MAX)) {
      throw new ValidationError(`note must be a string up to ${HOLD_NOTE_MAX} characters`)
    }
    const result = await setHold(id, auth.session.discordId, body.note as string | null | undefined, 'web')
    if (result === 'not-found') throw new NotFoundError('Recording')
    if (result === 'already') throw new ConflictError('This call is already on hold')
    return NextResponse.json({ success: true })
  }

  const result = await releaseHold(id, auth.session.discordId, 'web')
  if (result === 'not-found') throw new NotFoundError('Recording')
  if (result === 'not-held') throw new ConflictError('This call is not on hold')
  return NextResponse.json({ success: true })
})
