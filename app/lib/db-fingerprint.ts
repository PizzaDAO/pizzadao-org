/**
 * A content fingerprint of a small, hot, rarely-changing table: the md5 of every row's text, worked
 * out in the database. A cache that has the rows already asks for this (32 bytes over the wire)
 * instead of re-reading every row when its TTL runs out, and re-reads only when it changed.
 */
import { prisma } from '@/app/lib/db'

/** Only these tables (the name goes into the SQL, so it is never caller text). */
export type FingerprintTable = 'AppSetting' | 'Mission'

/** The fingerprint, or null when it could not be read (callers then do the full read). */
export async function tableFingerprint(table: FingerprintTable): Promise<string | null> {
  try {
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT md5(coalesce(string_agg(t::text, ',' ORDER BY t::text), '')) AS fp FROM "${table}" t`,
    )) as Array<{ fp?: unknown }> | undefined
    const fp = rows?.[0]?.fp
    return typeof fp === 'string' && fp ? fp : null
  } catch {
    return null
  }
}
