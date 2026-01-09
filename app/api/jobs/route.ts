import { NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { getJobs, getUserJob } from '@/app/lib/jobs'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const session = await getSession()
    const jobs = await getJobs()

    // Get current user's active job if authenticated
    let activeJob = null
    if (session?.discordId) {
      activeJob = await getUserJob(session.discordId)
    }

    return NextResponse.json({
      jobs: jobs.map(job => ({
        id: job.id,
        description: job.description,
        type: job.type,
        assignees: job.assignees
      })),
      activeJob: activeJob ? {
        id: activeJob.id,
        description: activeJob.description,
        type: activeJob.type
      } : null
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
