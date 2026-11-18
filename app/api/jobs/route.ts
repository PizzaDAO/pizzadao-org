import { NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { getDailyJobs, getCompletedJobsToday, getJobRewardAmount } from '@/app/lib/jobs'
import { NO_STORE_HEADERS } from '@/app/lib/no-store'
import { resolveDiscordMentions } from '@/app/lib/discord-mention-resolve'
import { internalError } from '@/app/lib/errors/error-response'

export const runtime = 'nodejs'

// Replace {amount} placeholder with actual reward
function replaceAmountPlaceholder(text: string, reward: number): string {
  return text.replace(/{amount}/gi, reward.toString())
}

export async function GET() {
  try {
    const session = await getSession()
    const { jobs, resetAt } = await getDailyJobs()
    const rewardAmount = await getJobRewardAmount()

    // Get jobs the user has completed today
    let completedJobIds: number[] = []
    if (session?.discordId) {
      completedJobIds = await getCompletedJobsToday(session.discordId)
    }

    const descriptions = jobs.map((job: any) => replaceAmountPlaceholder(job.description, rewardAmount))

    // Resolve any <#channelId> / <@&roleId> Discord mentions in the job
    // descriptions to names here, server-side (bot token stays on the
    // server) — the client renders them via DiscordText using these maps.
    const { channels, roles, users, guildId } = await resolveDiscordMentions(descriptions)

    return NextResponse.json({
      jobs: jobs.map((job: any, i: number) => ({
        id: job.id,
        description: descriptions[i],
        type: job.type,
        completed: completedJobIds.includes(job.id)
      })),
      resetAt: resetAt.toISOString(),
      rewardAmount,
      channels,
      roles,
      users,
      guildId
    }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    return internalError(error, 'jobs', 'Internal server error', 500, NO_STORE_HEADERS)
  }
}
