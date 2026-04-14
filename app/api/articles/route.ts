import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { hasAnyRole } from '@/app/lib/discord'
import { ARTICLE_AUTHOR_ROLE_IDS } from '@/app/ui/constants'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { UnauthorizedError, ForbiddenError } from '@/app/lib/errors/api-errors'
import { createArticle, getPublishedArticles, extractFirstImage } from '@/app/lib/articles'

export const runtime = 'nodejs'

// GET /api/articles - Public paginated list of published articles
const GET_HANDLER = async (request: NextRequest) => {
  const { searchParams } = new URL(request.url)

  const pageRaw = searchParams.get('page')
  const limitRaw = searchParams.get('limit')
  const tag = searchParams.get('tag') || undefined
  const search = searchParams.get('search') || undefined

  const page = pageRaw ? parseInt(pageRaw, 10) : 1
  const limit = limitRaw ? parseInt(limitRaw, 10) : 12

  const result = await getPublishedArticles({
    page: Number.isFinite(page) ? page : 1,
    limit: Number.isFinite(limit) ? limit : 12,
    tag,
    search,
  })

  // Compute thumbnail and strip content from list responses to reduce payload
  const articles = result.articles.map(({ content, ...rest }) => ({
    ...rest,
    thumbnail: rest.coverImage || extractFirstImage(content) || null,
  }))

  return NextResponse.json({ articles, pagination: result.pagination })
}

// POST /api/articles - Create a new article (role-gated)
const POST_HANDLER = async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.discordId) {
    throw new UnauthorizedError()
  }

  const canAuthor = await hasAnyRole(session.discordId, ARTICLE_AUTHOR_ROLE_IDS)
  if (!canAuthor) {
    throw new ForbiddenError('You do not have permission to create articles')
  }

  const body = await request.json()
  const { title, content, excerpt, coverImage, tags } = body ?? {}

  const authorName = session.nick || session.username || null

  const article = await createArticle(session.discordId, authorName, {
    title,
    content,
    excerpt,
    coverImage,
    tags,
  })

  return NextResponse.json({ article }, { status: 201 })
}

export const GET = withErrorHandling(GET_HANDLER)
export const POST = withErrorHandling(POST_HANDLER)
