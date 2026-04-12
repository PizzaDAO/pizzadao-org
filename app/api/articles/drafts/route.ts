import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { UnauthorizedError } from '@/app/lib/errors/api-errors'
import { getUserDrafts, getArticlesByAuthor, getCollaboratorDrafts } from '@/app/lib/articles'
import { fetchMemberIdByDiscordId } from '@/app/lib/sheets/member-repository'

export const runtime = 'nodejs'

// GET /api/articles/drafts - Author's drafts + articles where user is collaborator
const GET_HANDLER = async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.discordId) {
    throw new UnauthorizedError()
  }

  const { searchParams } = new URL(request.url)
  const includeAll = searchParams.get('all') === '1'

  const myMemberId = await fetchMemberIdByDiscordId(session.discordId).catch(() => null)

  const [ownArticles, collabArticles] = await Promise.all([
    includeAll
      ? getArticlesByAuthor(session.discordId)
      : getUserDrafts(session.discordId),
    myMemberId
      ? getCollaboratorDrafts(myMemberId, session.discordId)
      : [],
  ])

  // Merge and dedupe (in case author is also listed as collaborator)
  const seen = new Set(ownArticles.map(a => a.id))
  const articles = [...ownArticles, ...collabArticles.filter(a => !seen.has(a.id))]

  return NextResponse.json({ articles })
}

export const GET = withErrorHandling(GET_HANDLER)
