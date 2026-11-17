/**
 * Shared lookup of PizzaDAO member names by Discord id (the Member table,
 * merged members excluded). Fails soft: a DB error gives an empty map.
 */
import { prisma } from "./db"

export type MemberNameEntry = { name: string; memberId: string }

export async function memberNamesByDiscordId(discordIds: string[]): Promise<Map<string, MemberNameEntry>> {
  const out = new Map<string, MemberNameEntry>()
  const ids = [...new Set(discordIds.filter(Boolean))]
  if (ids.length === 0) return out
  try {
    const rows = await prisma.member.findMany({
      where: { discordId: { in: ids }, mergedInto: null },
      select: { id: true, discordId: true, name: true },
    })
    for (const row of rows) {
      const name = (row.name ?? "").trim()
      if (row.discordId && name && !out.has(row.discordId)) out.set(row.discordId, { name, memberId: row.id })
    }
  } catch {
    // DB unavailable: callers fall back to the guild name.
  }
  return out
}
