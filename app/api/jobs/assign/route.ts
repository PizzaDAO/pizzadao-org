import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/app/lib/auth-guards'
import { getJob, JOB_REWARD_AMOUNT, hasCompletedJobToday, recordDailyJobCompletion, isTodaysDailyJob } from '@/app/lib/jobs'
import { requireOnboarded, getOrCreateEconomy, formatCurrency } from '@/app/lib/economy'
import { discordTextToPlainText } from '@/app/lib/discord-markup'
import { resolveDiscordMentions } from '@/app/lib/discord-mention-resolve'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const auth = await requireSession()
    if (!auth.ok) return auth.response
    const { session } = auth

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

    // Only today's daily jobs pay out (the board shows 3); without this any
    // active job id could be completed for a reward every day.
    if (!(await isTodaysDailyJob(jobId))) {
      return NextResponse.json({ error: "This job is not one of today's jobs" }, { status: 400 })
    }

    // Fast path for a friendly error; the atomic check below is authoritative.
    const alreadyCompleted = await hasCompletedJobToday(session.discordId, jobId)
    if (alreadyCompleted) {
      return NextResponse.json({ error: 'You have already completed this job today' }, { status: 400 })
    }

    // Ensure the wallet row exists, then record completion + pay reward atomically.
    await getOrCreateEconomy(session.discordId)
    const rawDescription = job.description.replace(/{amount}/gi, JOB_REWARD_AMOUNT.toString())
    // Resolve any <#channelId> / <@&roleId> Discord mentions so the ledger
    // memo stores plain text, not raw markup (resolveDiscordMentions never
    // throws — a failed Discord lookup just falls back to "#channel"/"@role"
    // instead of a name).
    const { channels, roles } = await resolveDiscordMentions([rawDescription])
    // keepTimestamps: true — a <t:...> tag in the description shouldn't be
    // frozen to today's formatted date/relative string at write time; keep
    // it raw in the stored memo so display-time rendering (DiscordText)
    // formats it fresh, every time it's shown.
    const description = `Daily job: ${discordTextToPlainText(rawDescription, { channels, roles }, { keepTimestamps: true })}`
    const awarded = await recordDailyJobCompletion(session.discordId, jobId, JOB_REWARD_AMOUNT, description)
    if (!awarded) {
      return NextResponse.json({ error: 'You have already completed this job today' }, { status: 400 })
    }

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
