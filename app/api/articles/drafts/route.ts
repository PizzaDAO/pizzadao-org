import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { UnauthorizedError } from '@/app/lib/errors/api-errors'
import { getUserDrafts, getArticlesByAuthor } from '@/app/lib/articles'

export const runtime = 'nodejs'

// GET /api/articles/drafts - Authenticated author's drafts (optionally all statuses)
const GET_HANDLER = async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.discordId) {
    throw new UnauthorizedError()
  }

  const { searchParams } = new URL(request.url)
  const includeAll = searchParams.get('all') === '1'

  const articles = includeAll
    ? await getArticlesByAuthor(session.discordId)
    : await getUserDrafts(session.discordId)

  return NextResponse.json({ articles })
}

export const GET = withErrorHandling(GET_HANDLER)
