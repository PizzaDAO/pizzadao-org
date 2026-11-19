import { after } from 'next/server'
import { requireDpr, rejectUnsafeWrite, json } from '@/app/lib/admin-guard'
import { prisma } from '@/app/lib/db'
import { fetchMemberById } from '@/app/lib/sheets/member-repository'
import { saveWalletForMember } from '@/app/lib/wallet-lookup'
import { isValidEvmAddress, isValidSolanaAddress } from '@/app/lib/wallet-address'
import { emitMissionEvent } from '@/app/lib/mission-verify/events'
import { refreshRsvEventsIfEnabled } from '@/app/lib/events-attended/rsv'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/wallets  {memberId, walletAddress, chainType?, label?, note}
 * Adds a wallet to a member without a signature (custodial or lost-key cases). Dread Pizza Roberts
 * only (pinned role, never a setting). A note is required and the add is written to the admin audit
 * log (AppSettingChange, key `wallet:<memberId>:add`). The wallet is stored with source `admin`.
 */
export async function POST(request: Request) {
  const auth = await requireDpr()
  if (!auth.ok) return auth.response
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe

  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!b || typeof b !== 'object') return json({ error: 'Invalid body' }, 400)
  const memberId = String(b.memberId ?? '').trim()
  const walletAddress = String(b.walletAddress ?? '').trim()
  const chainType = b.chainType === undefined ? 'evm' : String(b.chainType)
  const note = String(b.note ?? '').trim()
  const label = typeof b.label === 'string' && b.label.trim() ? b.label.trim().slice(0, 30) : undefined

  if (!memberId) return json({ error: 'Missing memberId' }, 400)
  if (note.length < 5 || note.length > 500) return json({ error: 'A note of 5 to 500 characters is required' }, 400)
  if (chainType === 'evm') {
    if (!isValidEvmAddress(walletAddress)) return json({ error: 'Invalid EVM wallet address' }, 400)
  } else if (chainType === 'solana') {
    if (!isValidSolanaAddress(walletAddress)) return json({ error: 'Invalid Solana wallet address' }, 400)
  } else {
    return json({ error: "Invalid chain type (must be 'evm' or 'solana')" }, 400)
  }

  const member = await fetchMemberById(memberId, { fresh: true })
  if (!member) return json({ error: 'Member not found' }, 404)
  const discordId = String(member.discordId || '').trim() || undefined

  try {
    const wallet = await saveWalletForMember(memberId, walletAddress, 'admin', discordId, chainType, label)
    await prisma.appSettingChange.create({
      data: {
        key: `wallet:${memberId}:add`,
        newValue: { walletAddress, chainType, walletId: wallet.id },
        changedBy: auth.session.discordId,
        note,
      },
    })
    if (discordId) after(() => emitMissionEvent(discordId, 'wallet_connected', { memberId }).then(() => undefined))
    if (chainType === 'evm') after(() => refreshRsvEventsIfEnabled(memberId))
    return json({ success: true, wallet })
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'P2002') {
      return json({ error: 'This wallet is already linked to that member' }, 409)
    }
    console.error('POST /api/admin/wallets error:', e)
    return json({ error: 'Failed to add wallet' }, 500)
  }
}
