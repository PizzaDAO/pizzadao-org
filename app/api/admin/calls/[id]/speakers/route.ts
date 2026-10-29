import { NextResponse } from 'next/server'
import { requireCallReviewer } from '@/app/lib/calls/access'
import { setSpeakerLabel } from '@/app/lib/calls/speakers'
import { IMPORT_SPEAKER_ID } from '@/app/lib/calls/import'
import { SNOWFLAKE } from '@/app/lib/calls/ingest-schema'
import { fetchAllMembers } from '@/app/lib/sheets/members-list'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { ConflictError, NotFoundError, ValidationError } from '@/app/lib/errors/api-errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/calls/[id]/speakers  { "speakerId": "xs:2", "displayName": "Ann" }                  name a speaker
 *                                      { "speakerId": "xs:2", "linkedDiscordId": "<member's id>" }    link a PizzaDAO member (name filled in)
 *                                      { "speakerId": "xs:2" }                                         back to "Speaker N"
 * Dread Pizza Roberts only; imported calls only. Label PizzaDAO members only: guests stay "Speaker N".
 * Transcript keys are never rewritten, so redactions stay valid. The summary is not rewritten: regenerate it.
 */
export const POST = withErrorHandling(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const auth = await requireCallReviewer()
  if (!auth.ok) return auth.response

  const body = (await request.json().catch(() => null)) as { speakerId?: unknown; displayName?: unknown; linkedDiscordId?: unknown } | null
  if (typeof body?.speakerId !== 'string' || !IMPORT_SPEAKER_ID.test(body.speakerId)) throw new ValidationError('speakerId must look like xs:N')
  if (body.displayName !== undefined && body.displayName !== null && typeof body.displayName !== 'string') throw new ValidationError('displayName must be text')
  let linked: string | null = null
  let memberName: string | null = null
  if (body.linkedDiscordId !== undefined && body.linkedDiscordId !== null && body.linkedDiscordId !== '') {
    if (typeof body.linkedDiscordId !== 'string' || !SNOWFLAKE.test(body.linkedDiscordId)) throw new ValidationError('linkedDiscordId must be a Discord id')
    // Only a real PizzaDAO member can be linked.
    const members = await fetchAllMembers({ includeDiscordId: true, includeUnonboarded: true })
    const hit = members.find((m) => m.discordId === body.linkedDiscordId)
    if (!hit) throw new ValidationError('That Discord id is not a PizzaDAO member')
    linked = body.linkedDiscordId
    memberName = hit.name
  }

  const { id } = await ctx.params
  const result = await setSpeakerLabel(id, body.speakerId, { displayName: (body.displayName as string | null | undefined) ?? null, linkedDiscordId: linked, memberName })
  if (result === 'not-found') throw new NotFoundError('Speaker')
  if (result === 'not-supported') throw new ConflictError('Only speakers of imported calls can be labelled')
  if (result === 'invalid') throw new ValidationError('That label is not valid')
  return NextResponse.json({ success: true })
})
