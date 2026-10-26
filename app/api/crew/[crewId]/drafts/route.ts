import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { createDraft, listDrafts } from '@/app/lib/crew-drafts'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { UnauthorizedError, ValidationError } from '@/app/lib/errors/api-errors'
import { NO_STORE_HEADERS } from '@/app/lib/no-store'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ crewId: string }> }

// GET - drafts for the crew (members only). ?archived=1 includes archived.
const GET_HANDLER = async (request: NextRequest, { params }: Ctx) => {
  const session = await getSession()
  if (!session?.discordId) throw new UnauthorizedError()
  const { crewId } = await params
  const includeArchived = request.nextUrl.searchParams.get('archived') === '1'
  const { access, drafts } = await listDrafts(session.discordId, crewId, { includeArchived })
  return NextResponse.json({ access, drafts }, { headers: NO_STORE_HEADERS })
}

// POST - create a draft (members only)
const POST_HANDLER = async (request: NextRequest, { params }: Ctx) => {
  const session = await getSession()
  if (!session?.discordId) throw new UnauthorizedError()
  const { crewId } = await params
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') throw new ValidationError('Invalid body')
  const draft = await createDraft(session.discordId, crewId, body)
  return NextResponse.json({ draft }, { status: 201, headers: NO_STORE_HEADERS })
}

export const GET = withErrorHandling(GET_HANDLER)
export const POST = withErrorHandling(POST_HANDLER)
