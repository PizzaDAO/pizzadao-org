// Best-effort display labels for the Discord IDs in the shop audit log
// (admins and grant / removal targets), from the cached members sheet.
// A sheet outage just means IDs are shown bare.
import { getSheetData } from './sheets/member-repository'
import type { ShopAdminEventView } from './shop-admin'

export type PeopleLabels = Record<string, { memberId: string; name: string }>

export async function labelPeople(discordIds: Iterable<string>): Promise<PeopleLabels> {
  const ids = [...new Set([...discordIds].filter(Boolean))]
  if (ids.length === 0) return {}
  const sheet = await getSheetData().catch(() => null)
  if (!sheet) return {}
  const out: PeopleLabels = {}
  for (const id of ids) {
    const memberId = sheet.discordToMember.get(id)
    const idx = memberId === undefined ? undefined : sheet.memberToIdx.get(memberId)
    if (memberId === undefined || idx === undefined) continue
    const row = sheet.rows[idx]
    out[id] = { memberId, name: String(row?.['Name'] || row?.['Mafia Name'] || '').trim() }
  }
  return out
}

export function eventPeople(events: readonly ShopAdminEventView[]): string[] {
  return events.flatMap((e) => [e.actorId, e.targetId ?? ''])
}
