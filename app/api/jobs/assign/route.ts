import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { assignJob, assignRandomJob } from '@/app/lib/jobs'
import { requireOnboarded } from '@/app/lib/economy'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()

    if (!session?.discordId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    await requireOnboarded(session.discordId)

    const body = await request.json()
    const { jobId } = body

    let job
    if (jobId && typeof jobId === 'number') {
      // Assign specific job
      job = await assignJob(session.discordId, jobId)
    } else {
      // Assign random job (round-robin)
      job = await assignRandomJob(session.discordId)
    }

    return NextResponse.json({
      success: true,
      message: `Assigned to job: ${job.description}`,
      job: {
        id: job.id,
        description: job.description,
        type: job.type
      }
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
