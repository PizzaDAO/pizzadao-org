import { prisma } from './db'
import { ValidationError, NotFoundError, ForbiddenError } from './errors/api-errors'

export const COMMENT_BODY_MAX = 500
export const COMMENT_COOLDOWN_MS = 30_000

export interface CommentInput {
  body: string
}

export interface CommentRecord {
  id: number
  articleId: number
  authorId: string
  authorName: string | null
  body: string
  replyToId: number | null
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}

/**
 * Trim a comment body and enforce the 500-char limit.
 * Returns the cleaned string; throws ValidationError on bad input.
 */
export function validateCommentBody(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new ValidationError('Comment body is required')
  }
  const trimmed = raw.trim()
  if (!trimmed) {
    throw new ValidationError('Comment cannot be empty')
  }
  if (trimmed.length > COMMENT_BODY_MAX) {
    throw new ValidationError(`Comment must be ${COMMENT_BODY_MAX} characters or fewer`)
  }
  return trimmed
}

/**
 * Reject a new comment if the same author posted on the same article within
 * the cooldown window. v1 rate-limit; cheap single Prisma query.
 */
export async function checkCommentRateLimit(
  articleId: number,
  authorId: string,
  cooldownMs = COMMENT_COOLDOWN_MS
): Promise<void> {
  const last = await prisma.articleComment.findFirst({
    where: { articleId, authorId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  })
  if (!last) return
  const elapsed = Date.now() - last.createdAt.getTime()
  if (elapsed < cooldownMs) {
    const wait = Math.ceil((cooldownMs - elapsed) / 1000)
    throw new ValidationError(
      `You're commenting too fast — wait ${wait}s and try again.`,
      'cooldown'
    )
  }
}

/**
 * List comments on an article, oldest-first within the article so threading
 * still works if we add it later. Capped at 200 to bound the response.
 */
export async function listComments(articleId: number): Promise<CommentRecord[]> {
  return prisma.articleComment.findMany({
    where: { articleId },
    orderBy: { createdAt: 'asc' },
    take: 200,
  })
}

/**
 * Insert a new comment. Rate-limit + validation are run before this.
 */
export async function createComment(input: {
  articleId: number
  authorId: string
  authorName: string | null
  body: string
}): Promise<CommentRecord> {
  return prisma.articleComment.create({
    data: {
      articleId: input.articleId,
      authorId: input.authorId,
      authorName: input.authorName,
      body: input.body,
    },
  })
}

export async function getCommentById(id: number): Promise<CommentRecord | null> {
  return prisma.articleComment.findUnique({ where: { id } })
}

/**
 * Edit a comment. Only the original author may edit; admins do NOT get
 * edit permission (deliberate — they can delete but not rewrite).
 */
export async function updateComment(
  id: number,
  actorDiscordId: string,
  body: string
): Promise<CommentRecord> {
  const existing = await prisma.articleComment.findUnique({ where: { id } })
  if (!existing || existing.deletedAt) throw new NotFoundError('Comment')
  if (existing.authorId !== actorDiscordId) {
    throw new ForbiddenError('Only the author can edit this comment')
  }
  return prisma.articleComment.update({
    where: { id },
    data: { body },
  })
}

/**
 * Soft-delete a comment. Author or admin may delete; the body is cleared.
 */
export async function deleteComment(
  id: number,
  actorDiscordId: string,
  isAdmin: boolean
): Promise<CommentRecord> {
  const existing = await prisma.articleComment.findUnique({ where: { id } })
  if (!existing || existing.deletedAt) throw new NotFoundError('Comment')
  const isAuthor = existing.authorId === actorDiscordId
  if (!isAuthor && !isAdmin) {
    throw new ForbiddenError('Only the author or an admin can delete this comment')
  }
  return prisma.articleComment.update({
    where: { id },
    data: {
      body: '',
      deletedAt: new Date(),
    },
  })
}
