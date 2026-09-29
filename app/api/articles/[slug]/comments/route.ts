import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { hasAnyRole } from '@/app/lib/discord'
import { ADMIN_ROLE_IDS } from '@/app/ui/constants'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import {
  UnauthorizedError,
  NotFoundError,
} from '@/app/lib/errors/api-errors'
import { getArticleBySlug } from '@/app/lib/articles'
import {
  checkCommentRateLimit,
  createComment,
  listComments,
  validateCommentBody,
} from '@/app/lib/article-comments'
import { fetchMemberIdByDiscordId } from '@/app/lib/sheets/member-repository'
import { createNotification, NotificationType } from '@/app/lib/notifications'

export const runtime = 'nodejs'

type Params = { params: Promise<{ slug: string }> }

// Resolve a list of distinct discord IDs to their memberIds.
async function resolveAuthorMemberIds(discordIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const unique = Array.from(new Set(discordIds))
  await Promise.all(
    unique.map(async (id) => {
      try {
        const mid = await fetchMemberIdByDiscordId(id)
        if (mid) out.set(id, mid)
      } catch {
        /* non-fatal */
      }
    })
  )
  return out
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + '…'
}

// GET /api/articles/[slug]/comments — list comments for an article.
// Published articles are public; drafts require author/collaborator/admin.
const GET_HANDLER = async (_req: NextRequest, { params }: Params) => {
  const { slug } = await params
  const article = await getArticleBySlug(slug)
  if (!article) throw new NotFoundError('Article')

  if (article.status !== 'PUBLISHED') {
    const session = await getSession()
    if (!session?.discordId) throw new NotFoundError('Article')
    const isAuthor = session.discordId === article.authorId
    const myMemberId = await fetchMemberIdByDiscordId(session.discordId).catch(() => null)
    const isCollaborator = myMemberId
      ? (article.collaboratorMemberIds ?? []).includes(myMemberId)
      : false
    const isAdmin = isAuthor || isCollaborator
      ? true
      : await hasAnyRole(session.discordId, ADMIN_ROLE_IDS)
    if (!isAuthor && !isCollaborator && !isAdmin) {
      throw new NotFoundError('Article')
    }
  }

  const rows = await listComments(article.id)
  const memberIds = await resolveAuthorMemberIds(rows.map((r) => r.authorId))

  const comments = rows.map((c) => ({
    id: c.id,
    articleId: c.articleId,
    authorId: c.authorId,
    authorName: c.authorName,
    authorMemberId: memberIds.get(c.authorId) ?? null,
    body: c.deletedAt ? '' : c.body,
    isDeleted: c.deletedAt !== null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  }))

  return NextResponse.json(
    { comments },
    { headers: { 'Cache-Control': 'private, no-cache' } }
  )
}

// POST /api/articles/[slug]/comments — add a new comment (auth required).
const POST_HANDLER = async (request: NextRequest, { params }: Params) => {
  const { slug } = await params
  const session = await getSession()
  if (!session?.discordId) throw new UnauthorizedError()

  const article = await getArticleBySlug(slug)
  if (!article) throw new NotFoundError('Article')

  // Drafts: only author, collaborator, or admin can comment.
  if (article.status !== 'PUBLISHED') {
    const isAuthor = session.discordId === article.authorId
    const myMemberId = await fetchMemberIdByDiscordId(session.discordId).catch(() => null)
    const isCollaborator = myMemberId
      ? (article.collaboratorMemberIds ?? []).includes(myMemberId)
      : false
    const isAdmin = isAuthor || isCollaborator
      ? true
      : await hasAnyRole(session.discordId, ADMIN_ROLE_IDS)
    if (!isAuthor && !isCollaborator && !isAdmin) {
      throw new NotFoundError('Article')
    }
  }

  const json = await request.json().catch(() => ({}))
  const body = validateCommentBody(json?.body)

  await checkCommentRateLimit(article.id, session.discordId)

  const authorName = (session.nick || session.username || '').trim() || null
  const created = await createComment({
    articleId: article.id,
    authorId: session.discordId,
    authorName,
    body,
  })

  // Notify the article author (skip self-comments).
  if (article.authorId && article.authorId !== session.discordId) {
    try {
      await createNotification({
        type: NotificationType.ARTICLE_COMMENT,
        recipientId: article.authorId,
        actorId: session.discordId,
        title: 'New comment on your article',
        message: `"${truncate(article.title, 50)}" — ${truncate(body, 80)}`,
        metadata: { articleId: article.id, commentId: created.id },
        linkUrl: `/articles/${article.slug}`,
      })
    } catch {
      /* non-fatal: comment is saved even if notification fails */
    }
  }

  const authorMemberId = await fetchMemberIdByDiscordId(created.authorId).catch(() => null)

  return NextResponse.json(
    {
      comment: {
        id: created.id,
        articleId: created.articleId,
        authorId: created.authorId,
        authorName: created.authorName,
        authorMemberId,
        body: created.body,
        isDeleted: false,
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
      },
    },
    { status: 201 }
  )
}

export const GET = withErrorHandling(GET_HANDLER)
export const POST = withErrorHandling(POST_HANDLER)
