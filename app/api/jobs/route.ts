import { NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { getDailyJobs, getCompletedJobsToday, JOB_REWARD_AMOUNT } from '@/app/lib/jobs'
import { NO_STORE_HEADERS } from '@/app/lib/no-store'
import { resolveDiscordMentions } from '@/app/lib/discord-mention-resolve'

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

    const descriptions = jobs.map((job: any) => replaceAmountPlaceholder(job.description))

    // Resolve any <#channelId> / <@&roleId> Discord mentions in the job
    // descriptions to names here, server-side (bot token stays on the
    // server) — the client renders them via DiscordText using these maps.
    const { channels, roles, guildId } = await resolveDiscordMentions(descriptions)

    return NextResponse.json({
      jobs: jobs.map((job: any, i: number) => ({
        id: job.id,
        description: descriptions[i],
        type: job.type,
        assignees: job.assignees,
        completed: completedJobIds.includes(job.id)
      })),
      resetAt: resetAt.toISOString(),
      rewardAmount: JOB_REWARD_AMOUNT,
      channels,
      roles,
      guildId
    }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500, headers: NO_STORE_HEADERS })
  }
}
