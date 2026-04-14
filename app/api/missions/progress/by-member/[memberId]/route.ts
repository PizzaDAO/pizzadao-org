import { NextRequest, NextResponse } from 'next/server'
import { fetchMemberById } from '@/app/lib/sheets/member-repository'
import { getUserProgressSummary } from '@/app/lib/missions'

export const runtime = 'nodejs'

// GET - Get a user's mission progress by member ID (for profiles)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ memberId: string }> }
) {
  try {
    const { memberId } = await params

    if (!memberId) {
      return NextResponse.json({ error: 'Missing memberId' }, { status: 400 })
    }

    // Resolve memberId to discordId via the crew sheet
    const member = await fetchMemberById(memberId)
    if (!member?.discordId) {
      // No discordId found - return empty progress
      return NextResponse.json({
        currentLevel: 1,
        levelTitle: null,
        totalMissions: 0,
        approvedCount: 0,
        currentLevelMissions: 0,
        currentLevelApproved: 0,
      })
    }

    const summary = await getUserProgressSummary(member.discordId)

    return NextResponse.json(summary)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
