import { NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { quitJob } from '@/app/lib/jobs'
import { requireOnboarded } from '@/app/lib/economy'

export const runtime = 'nodejs'

export async function POST() {
  try {
    const session = await getSession()

    if (!session?.discordId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    await requireOnboarded(session.discordId)
    await quitJob(session.discordId)

    return NextResponse.json({
      success: true,
      message: 'You have quit your job'
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
