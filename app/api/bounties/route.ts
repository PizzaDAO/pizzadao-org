import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { canManageCrew, canManageBounty } from '@/app/lib/crew-leads'
import { normalizeCrewId } from '@/app/lib/crew-id'
import { getAllBounties, createBounty, resolveBountyCrewId, getCrewLabelMap } from '@/app/lib/bounties'
import { requireOnboarded } from '@/app/lib/economy'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { UnauthorizedError, ValidationError } from '@/app/lib/errors/api-errors'
import { NO_STORE_HEADERS } from '@/app/lib/no-store'
import { resolveDiscordMentions } from '@/app/lib/discord-mention-resolve'

export const runtime = 'nodejs'

// GET - List all bounties. Optional ?crewId=<slug> limits to one crew's bounties.
export async function GET(request: NextRequest) {
  try {
    const crewId = request.nextUrl.searchParams.get('crewId')
    const bounties = await getAllBounties({ crewId })
    const crewLabels = bounties.some((b) => b.crewId) ? await getCrewLabelMap() : new Map<string, string>()

    // Resolve any <#channelId> / <@&roleId> Discord mentions in the bounty
    // descriptions to names here, server-side (bot token stays on the
    // server) — the client renders them via DiscordText using these maps,
    // same as /api/jobs.
    const { channels, roles, guildId } = await resolveDiscordMentions(bounties.map((b) => b.description))

    // Who is looking (crew page only): lets the UI show Approve/Reject on bounties
    // posted by others. Advisory only; the write routes re-check every time.
    let viewer: { discordId: string; canManageCrew: boolean } | undefined
    if (crewId) {
      const session = await getSession().catch(() => null)
      if (session?.discordId) {
        viewer = {
          discordId: session.discordId,
          canManageCrew: await canManageCrew(session.discordId, normalizeCrewId(crewId)),
        }
      }
    }

    // Submission details are only for the poster, the claimer, and crew leads / admins.
    const sessionId = viewer?.discordId ?? (await getSession().catch(() => null))?.discordId
    const canSeeSubmission = async (b: (typeof bounties)[number]) => {
      if (!sessionId) return false
      if (b.createdBy === sessionId || b.claimedBy === sessionId) return true
      if (viewer?.canManageCrew && b.crewId) return true
      return b.crewId ? canManageBounty(sessionId, b) : false
    }
    const visible = new Set<number>()
    await Promise.all(bounties.map(async (b) => { if (await canSeeSubmission(b)) visible.add(b.id) }))

    return NextResponse.json({
      ...(viewer ? { viewer } : {}),
      bounties: bounties.map((b) => ({
        id: b.id,
        description: b.description,
        link: b.link,
        reward: b.reward,
        createdBy: b.createdBy,
        claimedBy: b.claimedBy,
        status: b.status,
        submissionNote: visible.has(b.id) ? (b.submissionNote ?? null) : null,
        submissionLink: visible.has(b.id) ? (b.submissionLink ?? null) : null,
        submittedAt: b.submittedAt ? b.submittedAt.toISOString() : null,
        reviewNote: visible.has(b.id) ? (b.reviewNote ?? null) : null,
        crewId: b.crewId ?? null,
        crewLabel: b.crewId ? (crewLabels.get(b.crewId) ?? b.crewId) : null,
        createdAt: b.createdAt.toISOString(),
        commentCount: b._count.comments
      })),
      channels,
      roles,
      guildId
    }, {
      headers: NO_STORE_HEADERS
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500, headers: NO_STORE_HEADERS })
  }
}

// POST - Create a new bounty
const POST_HANDLER = async (request: NextRequest) => {
  const session = await getSession()

  if (!session?.discordId) {
    throw new UnauthorizedError()
  }

  await requireOnboarded(session.discordId)

  const body = await request.json()
  const { description, reward, link } = body

  if (!description || typeof description !== 'string') {
    throw new ValidationError('Description required')
  }

  if (!reward || typeof reward !== 'number' || reward <= 0) {
    throw new ValidationError('Valid reward amount required')
  }

  // Optional crew tag (jalapeno-82565). Same permission as any bounty:
  // every onboarded member — crew leads included — can post a crew bounty.
  const crewId = await resolveBountyCrewId(body.crewId)

  const bounty = await createBounty(session.discordId, description, reward, link, crewId)

  return NextResponse.json({
    success: true,
    bounty: {
      id: bounty.id,
      description: bounty.description,
      link: bounty.link,
      reward: bounty.reward,
      status: bounty.status,
      crewId: bounty.crewId ?? null,
      createdAt: bounty.createdAt.toISOString()
    }
  })
}

export const POST = withErrorHandling(POST_HANDLER)
