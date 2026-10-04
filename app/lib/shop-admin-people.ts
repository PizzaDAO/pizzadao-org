// Display labels for the Discord IDs in the shop audit log (admins and grant /
// removal targets): the Crew-sheet name, else the Discord nickname / username,
// else nothing (the raw ID is shown). See ./people.ts.
import { resolvePeople, type PersonLabel, type ResolveOptions } from './people'
import type { ShopAdminEventView } from './shop-admin'

export type PeopleLabels = Record<string, { memberId?: string; name: string; handle?: string }>

export async function labelPeople(discordIds: Iterable<string>, opts: ResolveOptions = {}): Promise<PeopleLabels> {
  const ids = [...new Set([...discordIds].filter(Boolean))]
  if (ids.length === 0) return {}
  const resolved = await resolvePeople(ids, opts).catch(() => new Map<string, PersonLabel>())
  const out: PeopleLabels = {}
  for (const l of resolved.values()) {
    if (l.source === 'id') continue
    out[l.discordId] = { name: l.name, ...(l.memberId ? { memberId: l.memberId } : {}), ...(l.handle ? { handle: l.handle } : {}) }
  }
  return out
}

export function eventPeople(events: readonly ShopAdminEventView[]): string[] {
  return events.flatMap((e) => [e.actorId, e.targetId ?? ''])
}
