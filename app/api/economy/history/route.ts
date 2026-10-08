import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { getTransactionHistory } from '@/app/lib/transactions'
import { NO_STORE_HEADERS } from '@/app/lib/no-store'
import { resolveDiscordMentions } from '@/app/lib/discord-mention-resolve'

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
    const { channels, roles, guildId } = await resolveDiscordMentions(transactions.map((t) => t.description))

    return NextResponse.json({ transactions, total, channels, roles, guildId }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 400, headers: NO_STORE_HEADERS })
  }
}
