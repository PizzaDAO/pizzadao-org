import { NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { getMissionsByLevel, getUserMissionProgress, getCurrentLevel, getLevelTitle } from '@/app/lib/missions'

export const runtime = 'nodejs'

// GET - List all missions + user progress if authenticated
export async function GET() {
  try {
    const session = await getSession()

    const missionsByLevel = await getMissionsByLevel()

    let progress: Awaited<ReturnType<typeof getUserMissionProgress>> = []
    let currentLevel = 1
    let levelTitle: string | null = null

    if (session?.discordId) {
      progress = await getUserMissionProgress(session.discordId)
      currentLevel = await getCurrentLevel(session.discordId)
      levelTitle = await getLevelTitle(currentLevel)
    }

    // Build progress map: missionId -> completion status
    const progressMap: Record<number, { status: string; submittedAt: string; reviewNote?: string | null }> = {}
    for (const p of progress) {
      progressMap[p.missionId] = {
        status: p.status,
        submittedAt: p.submittedAt.toISOString(),
        reviewNote: p.reviewNote,
      }
    }

    // Build levels array for response
    const levels = Object.entries(missionsByLevel).map(([levelNum, missions]) => {
      const level = parseInt(levelNum)
      return {
        level,
        title: missions[0]?.levelTitle || null,
        reward: missions[0]?.reward || 0,
        missions: missions.map(m => ({
          id: m.id,
          index: m.index,
          title: m.title,
          description: m.description,
          autoVerify: m.autoVerify,
          progress: progressMap[m.id] || null,
        })),
      }
    })

    return NextResponse.json({
      levels,
      currentLevel,
      levelTitle,
      isAuthenticated: !!session?.discordId,
    }, {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' }
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
