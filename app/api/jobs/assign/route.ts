import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { getJob, JOB_REWARD_AMOUNT, hasCompletedJobToday } from '@/app/lib/jobs'
import { requireOnboarded, updateBalance, formatCurrency } from '@/app/lib/economy'
import { prisma } from '@/app/lib/db'

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

    if (!jobId || typeof jobId !== 'number') {
      return NextResponse.json({ error: 'Job ID required' }, { status: 400 })
    }

    // Get the job
    const job = await getJob(jobId)
    if (!job || !job.isActive) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    // Check if already completed today
    const alreadyCompleted = await hasCompletedJobToday(session.discordId, jobId)
    if (alreadyCompleted) {
      return NextResponse.json({ error: 'You have already completed this job today' }, { status: 400 })
    }

    // Record the job completion
    await prisma.jobAssignment.create({
      data: {
        jobId,
        userId: session.discordId
      }
    })

    // Award the $PEP immediately
    await updateBalance(session.discordId, JOB_REWARD_AMOUNT)

    return NextResponse.json({
      success: true,
      message: `You earned ${formatCurrency(JOB_REWARD_AMOUNT)}!`,
      reward: JOB_REWARD_AMOUNT,
      job: {
        id: job.id,
        description: job.description.replace(/{amount}/gi, JOB_REWARD_AMOUNT.toString()),
        type: job.type
      }
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
