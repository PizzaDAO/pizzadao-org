import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { getTransactionHistory } from '@/app/lib/transactions'
import { NO_STORE_HEADERS } from '@/app/lib/no-store'
import { resolveDiscordMentions } from '@/app/lib/discord-mention-resolve'
import { memberNamesByDiscordId } from '@/app/lib/member-names'
import { getGuildMemberCleanName } from '@/app/lib/discord-channels'

// Most non-member counterparties looked up via the bot per page (one cached REST call each).
const MAX_COUNTERPART_LOOKUPS = 25
const DISCORD_ID = /^\d{15,25}$/

/** The other side of a transfer row (a Discord id from the row metadata), or null. */
function counterpartId(t: { type: string; metadata?: unknown }): string | null {
  if (t.type !== 'TRANSFER_SENT' && t.type !== 'TRANSFER_RECEIVED') return null
  const md = t.metadata as { toUserId?: unknown; fromUserId?: unknown } | null | undefined
  const id = t.type === 'TRANSFER_SENT' ? md?.toUserId : md?.fromUserId
  return typeof id === 'string' && DISCORD_ID.test(id) ? id : null
}

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const session = await getSession()

    if (!session?.discordId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401, headers: NO_STORE_HEADERS })
    }

    const { searchParams } = request.nextUrl
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '20', 10), 1), 100)
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10), 0)

    const { transactions, total } = await getTransactionHistory(session.discordId, limit, offset)

    // Older memos can still carry raw <#id> / <@&id> Discord markup (e.g.
    // pre-fix "Job reward: ..." rows) — resolve only the ids actually
    // referenced in this page of memos, server-side, so TransactionHistory
    // can render them via DiscordText same as job/bounty descriptions.
    const { channels, roles, users, guildId } = await resolveDiscordMentions(transactions.map((t) => t.description))

    // Transfer memos store raw ids ("Transfer to 1234..."); the stored memo stays
    // as the stable record and each transfer row gets the counterparty's name
    // instead: PizzaDAO name, else the cleaned guild name, else "a member".
    const ids = [...new Set(transactions.map(counterpartId).filter((id): id is string => !!id))]
    const members = await memberNamesByDiscordId(ids)
    const guildNames = new Map<string, string | null>()
    await Promise.all(
      ids
        .filter((id) => !members.has(id))
        .slice(0, MAX_COUNTERPART_LOOKUPS)
        .map(async (id) => guildNames.set(id, await getGuildMemberCleanName(id).catch(() => null))),
    )
    const rows = transactions.map((t) => {
      const id = counterpartId(t)
      if (!id) return t
      const member = members.get(id)
      return {
        ...t,
        counterpartName: member?.name ?? guildNames.get(id) ?? 'a member',
        counterpartMemberId: member?.memberId ?? null,
      }
    })

    return NextResponse.json({ transactions: rows, total, channels, roles, users, guildId }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 400, headers: NO_STORE_HEADERS })
  }
}
