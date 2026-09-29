import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { hasAnyRole } from '@/app/lib/discord'
import { ADMIN_ROLE_IDS } from '@/app/ui/constants'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import {
  UnauthorizedError,
  NotFoundError,
  ValidationError,
} from '@/app/lib/errors/api-errors'
import {
  deleteComment,
  getCommentById,
  updateComment,
  validateCommentBody,
} from '@/app/lib/article-comments'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

function parseId(raw: string): number {
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) {
    throw new ValidationError('Invalid comment id')
  }
  return n
}

// PATCH /api/articles/comments/[id] — edit own comment (author only).
const PATCH_HANDLER = async (request: NextRequest, { params }: Params) => {
  const { id: rawId } = await params
  const id = parseId(rawId)

  const session = await getSession()
  if (!session?.discordId) throw new UnauthorizedError()

  const json = await request.json().catch(() => ({}))
  const body = validateCommentBody(json?.body)

  const updated = await updateComment(id, session.discordId, body)

  return NextResponse.json({
    comment: {
      id: updated.id,
      articleId: updated.articleId,
      authorId: updated.authorId,
      authorName: updated.authorName,
      body: updated.body,
      isDeleted: updated.deletedAt !== null,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    },
  })
}

// DELETE /api/articles/comments/[id] — author or admin can soft-delete.
const DELETE_HANDLER = async (_req: NextRequest, { params }: Params) => {
  const { id: rawId } = await params
  const id = parseId(rawId)

  const session = await getSession()
  if (!session?.discordId) throw new UnauthorizedError()

  const existing = await getCommentById(id)
  if (!existing || existing.deletedAt) throw new NotFoundError('Comment')

  const isAuthor = existing.authorId === session.discordId
  const isAdmin = isAuthor
    ? false // skip the Discord roundtrip if the actor is already authorized
    : await hasAnyRole(session.discordId, ADMIN_ROLE_IDS)

  const deleted = await deleteComment(id, session.discordId, isAdmin)

  return NextResponse.json({
    comment: {
      id: deleted.id,
      articleId: deleted.articleId,
      authorId: deleted.authorId,
      authorName: deleted.authorName,
      body: '',
      isDeleted: true,
      createdAt: deleted.createdAt.toISOString(),
      updatedAt: deleted.updatedAt.toISOString(),
    },
  })
}

export const PATCH = withErrorHandling(PATCH_HANDLER)
export const DELETE = withErrorHandling(DELETE_HANDLER)
