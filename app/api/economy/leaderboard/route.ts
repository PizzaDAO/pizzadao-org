import { NextResponse } from 'next/server'
import { getLeaderboard, formatCurrency } from '@/app/lib/economy'
import { getSheetData } from '@/app/lib/sheets/member-repository'
import { NO_STORE_HEADERS } from '@/app/lib/no-store'
import { memberNamesByDiscordId, mapWithLimit } from '@/app/lib/member-names'
import { getGuildMemberCleanName } from '@/app/lib/discord-channels'
import { internalError } from '@/app/lib/errors/error-response'

export const runtime = 'nodejs'

// Balances change with every job, bounty, purchase and transfer, so the
// leaderboard is computed per request and never stored by the CDN or browser
// (it used to be memoized for 5 minutes and CDN-cached for up to 35).

export async function GET() {
  try {
    const leaderboard = await getLeaderboard(10)

    // spinach-65462: resolve each entry's Discord ID to a memberId on the
    // server so the /pep leaderboard can link to /profile/{memberId} (the
    // small integer sheet ID) instead of /profile/{discordSnowflake}. The
    // sheet is already cached (5-min TTL) so this is a single in-memory map
    // lookup per row — no extra fetches.
    const sheetData = await getSheetData().catch(() => null)
    const discordToMember = sheetData?.discordToMember ?? null

    // Names on the server, one query for the whole top 10: PizzaDAO name, else the
    // cleaned guild name, else "a member" (never a truncated id).
    const ids = leaderboard.map((entry: any) => String(entry.userId))
    const members = await memberNamesByDiscordId(ids)
    const guildNames = new Map<string, string | null>()
    await mapWithLimit(
      ids.filter((id: string) => !members.has(id)),
      5,
      async (id: string) => guildNames.set(id, await getGuildMemberCleanName(id).catch(() => null)),
    )

    const result = {
      leaderboard: leaderboard.map((entry: any, index: number) => ({
        rank: index + 1,
        userId: entry.userId,
        memberId: discordToMember?.get(String(entry.userId)) ?? null,
        name: members.get(String(entry.userId))?.name ?? guildNames.get(String(entry.userId)) ?? 'a member',
        balance: entry.balance,
        formatted: formatCurrency(entry.balance)
      }))
    }

    return NextResponse.json(result, {
      headers: NO_STORE_HEADERS
    })
  } catch (error) {
    return internalError(error, 'economy/leaderboard', 'Internal server error', 500, NO_STORE_HEADERS)
  }
}
