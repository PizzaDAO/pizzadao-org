/**
 * discordId -> memberId lookup for the import, from the members ("Crew")
 * sheet exported as CSV. Mirrors how app/lib/sheets/member-repository.ts
 * builds `discordToMember` (member ID column "ID"/"Crew ID"/"Member ID", or
 * column A; Discord column "Discord ID"/"Discord"), but parses plain CSV so
 * the import script does not depend on Next's data cache.
 *
 * Pure. The script supplies the CSV text (a file the owner downloaded, or the
 * sheet's public CSV export).
 */
import { parseCsv } from './snapshot'

// Same aliases as MEMBER_COLUMNS in app/lib/sheets/member-repository.ts.
const ID_ALIASES = ['id', 'crewid', 'memberid']
const DISCORD_ALIASES = ['discordid', 'discord', 'discorduserid']

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

export function membersCsvUrl(sheetId: string, tab = 'Crew'): string {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&headers=0&sheet=${encodeURIComponent(tab)}`
}

/**
 * Parse the members CSV. The header row is the first row (within the first
 * 100) that has a Name column and a Discord column, since the sheet has
 * banner rows above the table.
 */
export function parseMembersCsv(text: string): Map<string, string> {
  const rows = parseCsv(text)
  let headerIdx = -1
  let idxDiscord = -1
  let idxId = 0
  for (let r = 0; r < Math.min(rows.length, 100); r++) {
    const h = rows[r].map(norm)
    const d = h.findIndex((x) => DISCORD_ALIASES.includes(x))
    if (d >= 0 && h.includes('name')) {
      headerIdx = r
      idxDiscord = d
      const i = h.findIndex((x) => ID_ALIASES.includes(x))
      idxId = i >= 0 ? i : 0
      break
    }
  }
  if (headerIdx < 0) throw new Error('members CSV: no header row with Name and Discord ID columns')

  const out = new Map<string, string>()
  for (const row of rows.slice(headerIdx + 1)) {
    const memberId = (row[idxId] ?? '').trim()
    const discordId = (row[idxDiscord] ?? '').trim()
    if (memberId && /^\d{5,25}$/.test(discordId)) out.set(discordId, memberId)
  }
  return out
}

/**
 * Merge sources into the plan's `knownMembers` map: sheet members carry their
 * memberId; app users (User rows) without a sheet row map to null.
 */
export function mergeKnownMembers(sheet: Map<string, string>, appUserIds: Iterable<string>): Map<string, string | null> {
  const out = new Map<string, string | null>(sheet)
  for (const id of appUserIds) if (!out.has(id)) out.set(id, null)
  return out
}
