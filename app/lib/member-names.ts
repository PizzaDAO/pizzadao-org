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

/** Run `fn` over `items` with at most `limit` in flight; results keep input order. */
export async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}
