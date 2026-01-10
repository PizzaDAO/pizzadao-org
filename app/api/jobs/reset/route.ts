import { NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { prisma } from '@/app/lib/db'

export const runtime = 'nodejs'

// Admin-only endpoint to reset today's jobs
export async function POST() {
  try {
    const session = await getSession()

    if (!session?.discordId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // Get start of current UTC day
    const now = new Date()
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

    // Delete all job assignments from today (resets completed status)
    const deleted = await prisma.jobAssignment.deleteMany({
      where: {
        assignedAt: { gte: dayStart }
      }
    })

    return NextResponse.json({
      success: true,
      message: `Reset ${deleted.count} job completions for today`
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
