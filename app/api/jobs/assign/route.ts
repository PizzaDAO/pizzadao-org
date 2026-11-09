import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/app/lib/auth-guards'
import { getDayStart, getUsedJobMessageIds, getJob, getJobRewardAmount, hasCompletedJobToday, recordDailyJobCompletion, isTodaysDailyJob } from '@/app/lib/jobs'
import { requireOnboarded, getOrCreateEconomy, formatCurrency } from '@/app/lib/economy'
import { checkKeyedRateLimit, rateLimitResponse } from '@/app/lib/rate-limit'
import { verifyJobPost, verifyPostsEnabled, unverifiablePayOnClick, parseJobRequirements } from '@/app/lib/jobs-verify'
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

    const rewardAmount = await getJobRewardAmount()
    const rawDescription = job.description.replace(/{amount}/gi, rewardAmount.toString())
    // Resolve any <#channelId> / <@&roleId> Discord mentions so the ledger
    // memo stores plain text, not raw markup (resolveDiscordMentions never
    // throws — a failed Discord lookup just falls back to "#channel"/"@role"
    // instead of a name).
    const { channels, roles, users, guildId } = await resolveDiscordMentions([rawDescription])

    // Verify the member really did the job before paying (fails closed).
    let proof: { messageId: string; channelId?: string } | undefined
    const requirements = parseJobRequirements(rawDescription)
    if (requirements.channelIds.length > 0 && (await verifyPostsEnabled())) {
      const limited = await checkKeyedRateLimit('jobs-verify', session.discordId, undefined, { failClosed: true })
      if (!limited.success) return rateLimitResponse(limited)
      const result = await verifyJobPost({
        memberId: session.discordId,
        description: rawDescription,
        since: getDayStart(),
        usedMessageIds: await getUsedJobMessageIds(session.discordId),
      })
      if (!result.ok && result.reason === 'unreachable') {
        return NextResponse.json(
          { error: "We couldn't check Discord right now, so nothing was paid. Please try again in a minute.", code: 'DISCORD_UNAVAILABLE' },
          { status: 503 },
        )
      }
      if (!result.ok && result.reason === 'channel_unavailable') {
        return NextResponse.json(
          { error: "This job's channel can't be checked. Ask a mod to take a look.", code: 'CHANNEL_UNCHECKABLE' },
          { status: 409 },
        )
      }
      if (!result.ok && result.reason === 'reused') {
        return NextResponse.json(
          { error: 'That post already completed another job. Make a new post for this one, then tap Complete again.', code: 'POST_REUSED' },
          { status: 409 },
        )
      }
      if (!result.ok) {
        const name = channels[result.channelId]
        const where = name ? `#${name}` : 'the channel'
        return NextResponse.json(
          {
            error: `We couldn't find your post in ${where} today. Post it there, then tap Complete again.`,
            code: 'POST_NOT_FOUND',
            channelId: result.channelId,
            channelUrl: guildId ? `https://discord.com/channels/${guildId}/${result.channelId}` : null,
          },
          { status: 409 },
        )
      }
      if (result.messageId) proof = { messageId: result.messageId, channelId: result.channelId }
    } else if (requirements.channelIds.length === 0 && !(await unverifiablePayOnClick())) {
      return NextResponse.json(
        { error: "This job can't be checked automatically right now, so it isn't paying out.", code: 'UNVERIFIABLE' },
        { status: 409 },
      )
    }

    // Ensure the wallet row exists, then record completion + pay reward atomically.
    await getOrCreateEconomy(session.discordId)
    // keepTimestamps: true — a <t:...> tag in the description shouldn't be
    // frozen to today's formatted date/relative string at write time; keep
    // it raw in the stored memo so display-time rendering (DiscordText)
    // formats it fresh, every time it's shown.
    const description = `Daily job: ${discordTextToPlainText(rawDescription, { channels, roles, users }, { keepTimestamps: true })}`
    const awarded = await recordDailyJobCompletion(session.discordId, jobId, rewardAmount, description, proof)
    if (awarded === 'reused') {
      return NextResponse.json({ error: 'That post already completed another job.', code: 'POST_REUSED' }, { status: 409 })
    }
    if (!awarded) {
      return NextResponse.json({ error: 'You have already completed this job today' }, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      message: `You earned ${formatCurrency(rewardAmount)}!`,
      reward: rewardAmount,
      job: {
        id: job.id,
        description: job.description.replace(/{amount}/gi, rewardAmount.toString()),
        type: job.type
      }
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
