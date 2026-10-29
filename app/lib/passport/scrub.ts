/** Nulls raw coordinates on check-ins older than 30 days (distance and accuracy are kept). */
import { prisma } from '@/app/lib/db'

export const COORD_RETENTION_DAYS = 30

export async function scrubCoordinates(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - COORD_RETENTION_DAYS * 86_400_000)
  const r = await prisma.pizzeriaCheckIn.updateMany({
    where: { createdAt: { lt: cutoff }, OR: [{ lat: { not: null } }, { lng: { not: null } }] },
    data: { lat: null, lng: null },
  })
  return r.count
}
