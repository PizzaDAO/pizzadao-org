/**
 * Durable last-good copy of a guild's channel / role list (table DiscordGuildSnapshot), so a Discord
 * REST timeout does not blank channel names after a cold start. Cheap by design: reads happen only
 * when the in-memory copy is missing and Discord just failed; writes only when the list changed.
 * Everything is best effort and never throws (the table may not exist yet, the database may be down).
 */
export type SnapshotKind = 'channels' | 'roles'

const READ_TIMEOUT_MS = 1500

export async function readGuildSnapshot<T>(guildId: string, kind: SnapshotKind): Promise<T[] | null> {
  if (!process.env.DATABASE_URL) return null
  try {
    const { prisma } = await import('./db')
    const row = await Promise.race([
      prisma.discordGuildSnapshot.findUnique({ where: { guildId_kind: { guildId, kind } }, select: { payload: true } }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), READ_TIMEOUT_MS)),
    ])
    return row && Array.isArray(row.payload) ? (row.payload as T[]) : null
  } catch {
    return null
  }
}

export async function writeGuildSnapshot(guildId: string, kind: SnapshotKind, payload: unknown[]): Promise<void> {
  if (!process.env.DATABASE_URL) return
  try {
    const { prisma } = await import('./db')
    const data = { payload: payload as never, updatedAt: new Date() }
    await prisma.discordGuildSnapshot.upsert({ where: { guildId_kind: { guildId, kind } }, create: { guildId, kind, ...data }, update: data })
  } catch {
    // best effort
  }
}
