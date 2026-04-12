import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { prisma } from '@/app/lib/db'
import { fetchMemberById } from '@/app/lib/sheets/member-repository'

export const runtime = 'nodejs'

type Params = { params: Promise<{ memberId: string }> }

// GET /api/articles/by-member/[memberId] - Public published articles by a member
const GET_HANDLER = async (_req: NextRequest, { params }: Params) => {
  const { memberId } = await params

  // Look up the member's Discord ID from the sheet
  const member = await fetchMemberById(memberId).catch(() => null)
  const discordId = member?.discordId ? String(member.discordId) : null

  // Find articles where:
  // - authorId matches their Discord ID, OR
  // - authorId matches "member:{memberId}" (for members without Discord)
  // - memberId is in collaboratorMemberIds
  // Only return PUBLISHED articles on public profiles
  const authorConditions: Record<string, unknown>[] = [
    { authorId: `member:${memberId}` },
  ]
  if (discordId) {
    authorConditions.push({ authorId: discordId })
  }
  authorConditions.push({ collaboratorMemberIds: { has: memberId } })

  const articles = await prisma.article.findMany({
    where: {
      status: 'PUBLISHED',
      OR: authorConditions,
    },
    select: {
      slug: true,
      title: true,
      excerpt: true,
      coverImage: true,
      authorName: true,
      tags: true,
      publishedAt: true,
    },
    orderBy: { publishedAt: 'desc' },
    take: 20,
  })

  return NextResponse.json({ articles })
}

export const GET = withErrorHandling(GET_HANDLER)
