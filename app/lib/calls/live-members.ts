/** discordId -> app memberId, so a member shown on the live view links to /profile/<memberId>. Unknown ids get no link. */
import { prisma } from '@/app/lib/db'

export async function resolveMemberIds(discordIds: readonly string[]): Promise<Map<string, string>> {
  const ids = [...new Set(discordIds)].filter(Boolean)
  const out = new Map<string, string>()
  if (ids.length === 0) return out
  try {
    const rows = await prisma.attendanceSummary.findMany({ where: { discordId: { in: ids } }, select: { discordId: true, memberId: true } })
    for (const r of rows) if (r.memberId) out.set(r.discordId, r.memberId)
    // Members the attendance summary does not know yet: match on the Discord id directly.
    const missing = ids.filter((i) => !out.has(i))
    if (missing.length) {
      const ms = await prisma.member.findMany({ where: { discordId: { in: missing }, mergedInto: null }, select: { id: true, discordId: true } })
      for (const m of ms) if (m.discordId && !out.has(m.discordId)) out.set(m.discordId, m.id)
    }
  } catch {
    // no links, plain names
  }
  return out
}

/** discordId -> the member's name, for speakers the call itself has no display name for. */
export async function resolveMemberNames(discordIds: readonly string[]): Promise<Map<string, string>> {
  const ids = [...new Set(discordIds)].filter(Boolean)
  const out = new Map<string, string>()
  if (ids.length === 0) return out
  try {
    const ms = await prisma.member.findMany({ where: { discordId: { in: ids }, mergedInto: null }, select: { discordId: true, name: true } })
    for (const m of ms) if (m.discordId && m.name.trim() && !out.has(m.discordId)) out.set(m.discordId, m.name.trim())
  } catch {
    // no names
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
