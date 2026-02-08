import { NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { getDailyJobs, getCompletedJobsToday, JOB_REWARD_AMOUNT } from '@/app/lib/jobs'

export const runtime = 'nodejs'

// Replace {amount} placeholder with actual reward
function replaceAmountPlaceholder(text: string): string {
  return text.replace(/{amount}/gi, JOB_REWARD_AMOUNT.toString())
}

export async function GET() {
  try {
    const session = await getSession()
    const { jobs, resetAt } = await getDailyJobs()

    // Get jobs the user has completed today
    let completedJobIds: number[] = []
    if (session?.discordId) {
      completedJobIds = await getCompletedJobsToday(session.discordId)
    }

    return NextResponse.json({
      jobs: jobs.map((job: any) => ({
        id: job.id,
        description: replaceAmountPlaceholder(job.description),
        type: job.type,
        assignees: job.assignees,
        completed: completedJobIds.includes(job.id)
      })),
      resetAt: resetAt.toISOString(),
      rewardAmount: JOB_REWARD_AMOUNT
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
