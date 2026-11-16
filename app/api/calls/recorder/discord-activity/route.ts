import { NextResponse } from 'next/server'
import { isRecorderAuthorized } from '@/app/lib/calls/recorder-auth'
import { activityBatchSchema, applyActivityBatch } from '@/app/lib/discord-activity'
import { toggleEnabled } from '@/app/lib/settings/toggles'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { ValidationError } from '@/app/lib/errors/api-errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/calls/recorder/discord-activity: the recorder's batched Discord message counts (no content).
 * `Authorization: Bearer $RECORDER_API_KEY`. A batch id is applied once (a retry answers `duplicate`).
 * 204 when live counting is switched off (members.discordActivityCount): the recorder drops the batch.
 */
export const POST = withErrorHandling(async (request: Request) => {
  if (!isRecorderAuthorized(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new ValidationError('Body must be JSON')
  }
  const parsed = activityBatchSchema.safeParse(body)
  if (!parsed.success) throw new ValidationError('Invalid activity batch')
  if (!(await toggleEnabled('members.discordActivityCount'))) return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
  const out = await applyActivityBatch(parsed.data)
  return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } })
})
