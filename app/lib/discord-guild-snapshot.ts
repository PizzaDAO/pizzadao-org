/**
 * Durable last-good copy of a guild's channel / role list (table DiscordGuildSnapshot), so a Discord
 * REST timeout does not blank channel names after a cold start. Cheap by design: reads happen only
 * when the in-memory copy is missing and Discord just failed; writes happen when the list differs from what this instance last saw or read
 * (so about once per cold instance, plus real changes).
 * Everything is best effort and never throws (the table may not exist yet, the database may be down).
 */
import { after } from 'next/server'

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

/**
 * Save the snapshot without holding up the response: `after()` (called synchronously, so it is still
 * inside the request scope) runs it once the response is sent. When `after()` is unavailable (outside
 * a request, or inside a cached function) the write is returned as a promise the caller awaits, since
 * a detached write is frozen when a serverless function finishes. This happens about once per cold
 * instance, so the extra wait is rare.
 */
export function writeGuildSnapshotLater(guildId: string, kind: SnapshotKind, payload: unknown[]): Promise<void> | void {
  try {
    after(() => writeGuildSnapshot(guildId, kind, payload))
  } catch {
    return writeGuildSnapshot(guildId, kind, payload)
  }
}

export async function writeGuildSnapshot(guildId: string, kind: SnapshotKind, payload: unknown[]): Promise<void> {
  if (!process.env.DATABASE_URL) return
  try {
    const { prisma } = await import('./db')
    const data = { payload: payload as never, updatedAt: new Date() }
    // select: only the key comes back, never the JSONB payload (egress).
    await prisma.discordGuildSnapshot.upsert({ where: { guildId_kind: { guildId, kind } }, create: { guildId, kind, ...data }, update: data, select: { guildId: true } })
  } catch {
    // best effort
  }
}
