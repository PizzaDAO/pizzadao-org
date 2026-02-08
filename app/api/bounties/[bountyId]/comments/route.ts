import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { getBountyComments, addBountyComment } from '@/app/lib/bounties'
import { requireOnboarded } from '@/app/lib/economy'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { UnauthorizedError, ValidationError } from '@/app/lib/errors/api-errors'

export const runtime = 'nodejs'

// GET - List comments for a bounty
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ bountyId: string }> }
) {
  try {
    const { bountyId } = await params
    const id = parseInt(bountyId, 10)
    if (isNaN(id)) {
      return NextResponse.json({ error: 'Invalid bounty ID' }, { status: 400 })
    }

    const comments = await getBountyComments(id)

    return NextResponse.json({
      comments: comments.map(c => ({
        id: c.id,
        bountyId: c.bountyId,
        authorId: c.authorId,
        content: c.content,
        createdAt: c.createdAt.toISOString()
      }))
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// POST - Add a comment to a bounty
const POST_HANDLER = async (
  request: NextRequest,
  { params }: { params: Promise<{ bountyId: string }> }
) => {
  const session = await getSession()

  if (!session?.discordId) {
    throw new UnauthorizedError()
  }

  await requireOnboarded(session.discordId)

  const { bountyId } = await params
  const id = parseInt(bountyId, 10)
  if (isNaN(id)) {
    throw new ValidationError('Invalid bounty ID')
  }

  const body = await request.json()
  const { content } = body

  if (!content || typeof content !== 'string') {
    throw new ValidationError('Comment content required')
  }

  const comment = await addBountyComment(session.discordId, id, content)

  return NextResponse.json({
    success: true,
    comment: {
      id: comment.id,
      bountyId: comment.bountyId,
      authorId: comment.authorId,
      content: comment.content,
      createdAt: comment.createdAt.toISOString()
    }
  })
}

export const POST = withErrorHandling(POST_HANDLER)
