/**
 * Find the active (LISTED) disavowal for a member, for the profile chip and the
 * vouch warning. Matches only on member id, Discord id, wallet and X handle,
 * never on a name (collisions). Callers must have confirmed the viewer is
 * eligible first; this function does no access check.
 */
import { prisma } from '@/app/lib/db'
import { fetchMemberById } from '@/app/lib/sheets/member-repository'
import { getAllWalletsForMember } from '@/app/lib/wallet-lookup'
import { normalizeWallet, normalizeXHandle, type IdentifierInput } from './identity'

export async function identifiersForMember(memberId: string): Promise<IdentifierInput[]> {
  const out: IdentifierInput[] = [{ kind: 'MEMBER_ID', value: memberId }]
  try {
    const m = await fetchMemberById(memberId)
    if (m?.discordId) out.push({ kind: 'DISCORD_ID', value: String(m.discordId) })
  } catch { /* partial match is fine */ }
  try {
    for (const w of await getAllWalletsForMember(memberId)) {
      const v = normalizeWallet(w.walletAddress)
      if (v) out.push({ kind: 'WALLET', value: v })
    }
  } catch { /* ignore */ }
  try {
    const x = await prisma.xAccount.findFirst({ where: { memberId }, select: { xUsername: true } })
    const h = x ? normalizeXHandle(x.xUsername) : null
    if (h) out.push({ kind: 'X_HANDLE', value: h })
  } catch { /* ignore */ }
  return out
}

export async function findActiveListingFor(memberId: string): Promise<{ id: string } | null> {
  const ids = await identifiersForMember(memberId)
  const hit = await prisma.disavowIdentifier.findFirst({
    where: { OR: ids.map(i => ({ kind: i.kind, value: i.value })), disavowal: { status: 'LISTED' } } as never,
    select: { disavowalId: true },
  })
  return hit ? { id: hit.disavowalId } : null
}
