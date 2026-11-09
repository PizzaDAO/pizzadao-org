import { NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { prisma } from '@/app/lib/db'
import { fetchMemberIdByDiscordId } from '@/app/lib/sheets/member-repository'
import { saveWalletForMember } from '@/app/lib/wallet-lookup'
import { getTicketSummary, scanMembers } from '@/app/lib/unlock/scan'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET: after the Unlock sign-in redirect, add the signed wallet to the member's wallets and scan.
 * The connect flow is only a way to add a wallet: tickets always come from a scan of every wallet.
 * If the scan fails nothing is stored as "0 tickets"; the wallet is still added.
 */
export async function GET() {
  try {
    const session = await getSession()
    if (!session?.discordId || !session?.unlockWallet) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const memberId = await fetchMemberIdByDiscordId(session.discordId)
    if (!memberId) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

    const walletAddress = session.unlockWallet
    // Addresses are stored as given (often checksummed), so match case-insensitively to avoid a duplicate row.
    const existingWallet = await prisma.memberWallet.findFirst({
      where: { memberId, walletAddress: { equals: walletAddress, mode: 'insensitive' } },
      select: { id: true },
    })
    if (!existingWallet) await saveWalletForMember(memberId, walletAddress, 'unlock', session.discordId)

    try {
      await scanMembers([memberId], [{ memberId, wallet: walletAddress }])
    } catch (e) {
      console.error('[unlock-tickets/verify] scan failed', e)
      return NextResponse.json({ error: 'Wallet added, but the Unlock service could not be reached. Use Rescan in a few minutes.', walletAdded: true }, { status: 502 })
    }
    return NextResponse.json({ walletAddress, alreadyConnected: !!existingWallet, ...(await getTicketSummary(memberId)) })
  } catch (error) {
    console.error('Error connecting unlock wallet:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
