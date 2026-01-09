import { NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { hasAnyRole } from '@/app/lib/discord'
import { prisma } from '@/app/lib/db'
import { ADMIN_ROLE_IDS } from '@/app/ui/constants'

// GET /api/polls - List all polls (any authenticated user)
export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const polls = await prisma.poll.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      results: true,
    },
  })

  // Only include results for closed polls
  const sanitizedPolls = polls.map(poll => ({
    ...poll,
    results: poll.status === 'CLOSED' ? poll.results : [],
  }))

  return NextResponse.json(sanitizedPolls)
}

// POST /api/polls - Create a new poll (admin only)
export async function POST(req: Request) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check admin role
  const isAdmin = await hasAnyRole(session.discordId, ADMIN_ROLE_IDS)
  if (!isAdmin) {
    return NextResponse.json({ error: 'Forbidden: Admin role required' }, { status: 403 })
  }

  const body = await req.json()
  const { question, options, requiredRoleId } = body

  // Validate input
  if (!question || typeof question !== 'string') {
    return NextResponse.json({ error: 'Question is required' }, { status: 400 })
  }

  if (!Array.isArray(options) || options.length < 2) {
    return NextResponse.json({ error: 'At least 2 options required' }, { status: 400 })
  }

  for (const opt of options) {
    if (!opt.id || !opt.label) {
      return NextResponse.json({ error: 'Each option must have id and label' }, { status: 400 })
    }
  }

  if (!requiredRoleId || typeof requiredRoleId !== 'string') {
    return NextResponse.json({ error: 'Required role ID is required' }, { status: 400 })
  }

  const poll = await prisma.poll.create({
    data: {
      question,
      options,
      requiredRoleId,
      createdBy: session.discordId,
    },
  })

  return NextResponse.json(poll, { status: 201 })
}
