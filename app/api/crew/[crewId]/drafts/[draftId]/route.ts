import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { updateDraft } from '@/app/lib/crew-drafts'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { UnauthorizedError, ValidationError } from '@/app/lib/errors/api-errors'
import { NO_STORE_HEADERS } from '@/app/lib/no-store'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ crewId: string; draftId: string }> }

// PATCH - edit fields and/or move status, all-or-nothing (permissions are checked
// before anything is written). There is deliberately no DELETE: "archive"
// (status: "archived") is the only way to remove a draft.
const PATCH_HANDLER = async (request: NextRequest, { params }: Ctx) => {
  const session = await getSession()
  if (!session?.discordId) throw new UnauthorizedError()
  const { crewId, draftId: rawId } = await params
  const draftId = Number(rawId)
  if (!Number.isInteger(draftId) || draftId < 1) throw new ValidationError('Invalid draft id')
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError('Invalid body')

  const draft = await updateDraft(session.discordId, crewId, draftId, body)
  return NextResponse.json({ draft }, { headers: NO_STORE_HEADERS })
}

export const PATCH = withErrorHandling(PATCH_HANDLER)
