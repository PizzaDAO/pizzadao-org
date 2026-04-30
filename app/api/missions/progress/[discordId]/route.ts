import { NextRequest, NextResponse } from 'next/server'
import { getUserProgressSummary } from '@/app/lib/missions'

export const runtime = 'nodejs'

// GET - Get a user's mission progress (public, for profiles)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ discordId: string }> }
) {
  try {
    const { discordId } = await params

    if (!discordId) {
      return NextResponse.json({ error: 'Missing discordId' }, { status: 400 })
    }

    const summary = await getUserProgressSummary(discordId)

    return NextResponse.json(summary, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800' }
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
