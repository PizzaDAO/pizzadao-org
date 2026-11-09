/** discordId -> app memberId, so a member shown on the live view links to /profile/<memberId>. Unknown ids get no link. */
import { prisma } from '@/app/lib/db'

export async function resolveMemberIds(discordIds: readonly string[]): Promise<Map<string, string>> {
  const ids = [...new Set(discordIds)].filter(Boolean)
  const out = new Map<string, string>()
  if (ids.length === 0) return out
  try {
    const rows = await prisma.attendanceSummary.findMany({ where: { discordId: { in: ids } }, select: { discordId: true, memberId: true } })
    for (const r of rows) if (r.memberId) out.set(r.discordId, r.memberId)
  } catch {
    // no links, plain names
  }
  return out
}

export interface PersonRef {
  name: string | null
  /** App member id for /profile/<memberId>; null when unknown (and always null for anonymous askers). */
  memberId: string | null
}

export function personRef(name: string | null | undefined, discordId: string | null | undefined, members: ReadonlyMap<string, string>): PersonRef {
  return { name: name?.trim() || null, memberId: (discordId && members.get(discordId)) || null }
}
