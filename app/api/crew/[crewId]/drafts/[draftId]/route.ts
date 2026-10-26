import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { changeDraftStatus, editDraft } from '@/app/lib/crew-drafts'
import { DRAFT_STATUSES, type DraftStatus } from '@/app/lib/draft-text'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { UnauthorizedError, ValidationError } from '@/app/lib/errors/api-errors'
import { NO_STORE_HEADERS } from '@/app/lib/no-store'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ crewId: string; draftId: string }> }

// PATCH - edit fields and/or move status. There is deliberately no DELETE:
// "archive" (status: "archived") is the only way to remove a draft.
const PATCH_HANDLER = async (request: NextRequest, { params }: Ctx) => {
  const session = await getSession()
  if (!session?.discordId) throw new UnauthorizedError()
  const { crewId, draftId: rawId } = await params
  const draftId = Number(rawId)
  if (!Number.isInteger(draftId) || draftId < 1) throw new ValidationError('Invalid draft id')
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') throw new ValidationError('Invalid body')

  let draft
  const { status, postedUrl, ...fields } = body as Record<string, unknown>
  if (Object.keys(fields).length > 0) {
    draft = await editDraft(session.discordId, crewId, draftId, fields)
  }
  if (status !== undefined) {
    if (typeof status !== 'string' || !(DRAFT_STATUSES as readonly string[]).includes(status)) {
      throw new ValidationError('Invalid status', 'status')
    }
    draft = await changeDraftStatus(session.discordId, crewId, draftId, status as DraftStatus, { postedUrl })
  }
  if (!draft) throw new ValidationError('Nothing to update')
  return NextResponse.json({ draft }, { headers: NO_STORE_HEADERS })
}

export const PATCH = withErrorHandling(PATCH_HANDLER)
