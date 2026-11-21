/**
 * When a saved switch last went from off to on (the settings audit log; re-saving "on" does not move it),
 * while it is saved as on. Null when it is not saved as on (off, or on by env only). Used to act only on
 * what was made after a feature was switched on.
 */
import { prisma } from '@/app/lib/db'

export async function switchedOnAt(key: string): Promise<Date | null> {
  const row = await prisma.appSetting.findUnique({ where: { key }, select: { value: true, updatedAt: true } })
  if (!row || row.value !== true) return null
  const changes = await prisma.appSettingChange.findMany({ where: { key }, orderBy: { changedAt: 'desc' }, take: 20, select: { oldValue: true, newValue: true, changedAt: true } })
  return changes.find((c) => c.newValue === true && c.oldValue !== true)?.changedAt ?? row.updatedAt
}
