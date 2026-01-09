import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { completeJob, JOB_REWARD_AMOUNT } from '@/app/lib/jobs'
import { formatCurrency } from '@/app/lib/economy'
import { prisma } from '@/app/lib/db'

// Admin role IDs that can complete jobs
const ADMIN_ROLE_IDS = process.env.ADMIN_ROLE_IDS?.split(',') || []

export const runtime = 'nodejs'

async function isAdmin(discordId: string): Promise<boolean> {
  if (ADMIN_ROLE_IDS.length === 0) return false

  const user = await prisma.user.findUnique({
    where: { id: discordId }
  })

  if (!user) return false

  return user.roles.some(role => ADMIN_ROLE_IDS.includes(role))
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()

    if (!session?.discordId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // Check if user is admin
    const admin = await isAdmin(session.discordId)
    if (!admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const body = await request.json()
    const { userId, reward = JOB_REWARD_AMOUNT } = body

    if (!userId || typeof userId !== 'string') {
      return NextResponse.json({ error: 'User ID required' }, { status: 400 })
    }

    const rewardAmount = typeof reward === 'number' ? Math.floor(reward) : JOB_REWARD_AMOUNT

    const result = await completeJob(userId, rewardAmount)

    return NextResponse.json({
      success: true,
      message: rewardAmount > 0
        ? `Job completed! ${formatCurrency(rewardAmount)} awarded.`
        : 'Job completed with no reward.',
      job: {
        id: result.job.id,
        description: result.job.description
      },
      reward: rewardAmount
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
