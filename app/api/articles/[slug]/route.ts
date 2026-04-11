import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { hasAnyRole } from '@/app/lib/discord'
import { ADMIN_ROLE_IDS } from '@/app/ui/constants'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import {
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
} from '@/app/lib/errors/api-errors'
import {
  archiveArticle,
  getArticleBySlug,
  updateArticle,
} from '@/app/lib/articles'

export const runtime = 'nodejs'

type Params = { params: Promise<{ slug: string }> }

// GET /api/articles/[slug] - Read a single article.
// Published articles are public. Drafts require author or admin.
const GET_HANDLER = async (_req: NextRequest, { params }: Params) => {
  const { slug } = await params
  const article = await getArticleBySlug(slug)
  if (!article) throw new NotFoundError('Article')

  if (article.status !== 'PUBLISHED') {
    const session = await getSession()
    if (!session?.discordId) {
      throw new NotFoundError('Article')
    }
    const isAuthor = session.discordId === article.authorId
    const isAdmin = isAuthor
      ? true
      : await hasAnyRole(session.discordId, ADMIN_ROLE_IDS)
    if (!isAuthor && !isAdmin) {
      throw new NotFoundError('Article')
    }
  }

  return NextResponse.json({ article })
}

// PATCH /api/articles/[slug] - Update article (author or admin)
const PATCH_HANDLER = async (request: NextRequest, { params }: Params) => {
  const { slug } = await params
  const session = await getSession()
  if (!session?.discordId) {
    throw new UnauthorizedError()
  }

  const existing = await getArticleBySlug(slug)
  if (!existing) throw new NotFoundError('Article')

  const isAuthor = session.discordId === existing.authorId
  const isAdmin = await hasAnyRole(session.discordId, ADMIN_ROLE_IDS)
  if (!isAuthor && !isAdmin) {
    throw new ForbiddenError('Only the author or an admin can edit this article')
  }

  const body = await request.json()
  const { title, content, excerpt, coverImage, tags, status } = body ?? {}

  // Only admins can transition to ARCHIVED via PATCH
  if (status === 'ARCHIVED' && !isAdmin) {
    throw new ForbiddenError('Only admins can archive articles')
  }

  const updated = await updateArticle(slug, {
    title,
    content,
    excerpt,
    coverImage,
    tags,
    status,
  })

  return NextResponse.json({ article: updated })
}

// DELETE /api/articles/[slug] - Archive (soft delete). Admins only.
const DELETE_HANDLER = async (_req: NextRequest, { params }: Params) => {
  const { slug } = await params
  const session = await getSession()
  if (!session?.discordId) {
    throw new UnauthorizedError()
  }

  const isAdmin = await hasAnyRole(session.discordId, ADMIN_ROLE_IDS)
  if (!isAdmin) {
    throw new ForbiddenError('Only admins can delete articles')
  }

  const existing = await getArticleBySlug(slug)
  if (!existing) throw new NotFoundError('Article')

  const archived = await archiveArticle(slug)
  return NextResponse.json({ success: true, article: archived })
}

export const GET = withErrorHandling(GET_HANDLER)
export const PATCH = withErrorHandling(PATCH_HANDLER)
export const DELETE = withErrorHandling(DELETE_HANDLER)
