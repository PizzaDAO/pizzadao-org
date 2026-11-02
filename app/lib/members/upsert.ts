/**
 * The members-sheet write rules, ported from the Apps Script web app (backend_script.gs,
 * upsertToCrew_) so writes to the Member table behave exactly like writes to the sheet
 * (plans/sheets-cutover.md PR 7). Pure: it works on the header list and the member rows and
 * returns what to store.
 *
 * Kept from the script:
 * - match by member id (case-insensitive), then by Discord id except in claim mode;
 * - claim mode ("onboarding_claim") must match the typed member id, never inserts;
 * - never inserts a row without a member id, never blanks the ID cell;
 * - outside the two claim flows, never re-points a row to a different Discord account;
 * - every field is written only when the caller sent it; Status defaults to "Active";
 * - a Notes line is appended on every write.
 * One deliberate difference: a `turtles` value sent as text (the claim flows do this) is stored as
 * that text; the script wrote an empty cell in that case.
 */
import type { GvizCell } from '@/app/lib/types/gviz'

export const DEFAULT_STATUS_ON_INSERT = 'Active'

export type MemberCells = Array<GvizCell | null>

export interface MemberRowLike {
  id: string
  cells: MemberCells
}

export type MemberWriteRaw = Record<string, unknown>

export type UpsertResult =
  | { ok: true; skipped: true; reason: string }
  | { ok: true; skipped?: false; action: 'updated' | 'updated_by_discord' | 'inserted'; targetId: string; previousId: string | null; cells: MemberCells; id: string }
  | { ok: false; error: string }

export function normHeader(h: unknown): string {
  return String(h ?? '').trim().toLowerCase().replace(/[#\s\-_]+/g, '')
}

const ALIASES: Record<string, string[]> = {
  status: ['frequency', 'freq'],
  slug: ['memberid', 'id', 'slug'],
  id: ['crewid', 'memberid', 'id', 'idnum'],
  orgs: ['affiliation', 'affil', 'organization', 'org'],
  skills: ['specialties', 'specialty', 'skill'],
  discordid: ['discord', 'discorduser'],
  turtles: ['turtle', 'turtles'],
}

/** 0-based column index for a header name (with the script's aliases), or null. */
export function headerColumn(headers: readonly string[], name: string): number | null {
  const map = new Map<string, number>()
  headers.forEach((h, i) => {
    const k = normHeader(h)
    // The script's buildHeaderMap_ keeps the LAST column for a repeated header.
    if (k) map.set(k, i)
  })
  const primary = normHeader(name)
  if (map.has(primary)) return map.get(primary)!
  for (const a of ALIASES[primary] ?? []) if (map.has(a)) return map.get(a)!
  return null
}

/**
 * The script finds the ID column by the "ID" header. On the members sheet that column has a blank
 * header, so the read path falls back to column A; do the same here.
 */
export function idColumn(headers: readonly string[]): number {
  return headerColumn(headers, 'ID') ?? 0
}

export const cellString = (c: GvizCell | null | undefined): string => String(c?.v ?? c?.f ?? '').trim()

/** What the sheet would hold after the script's setValue(text): digit-only text becomes a number. */
function asSheetValue(text: string): GvizCell {
  return /^\d{1,15}$/.test(text) ? { v: Number(text) } : { v: text }
}

const joinList = (v: unknown) => (Array.isArray(v) ? v.join(', ') : String(v ?? ''))

export function planMemberUpsert(headers: readonly string[], members: readonly MemberRowLike[], raw: MemberWriteRaw, nowIso: string): UpsertResult {
  const colID = idColumn(headers)
  const memberId = String(raw.memberId ?? '').trim()
  const discordId = String(raw.discordId ?? '').trim()
  const source = String(raw.source ?? '').trim()
  const isClaim = source === 'onboarding_claim'
  const mayReassignDiscord = isClaim || source === 'onboarding_auto_claim'

  if (isClaim && !memberId) return { ok: false, error: 'Claim requires memberId.' }
  if (!memberId && !discordId) return { ok: true, skipped: true, reason: 'No memberId or discordId' }

  const colDiscord = headerColumn(headers, 'DiscordId')
  let target: MemberRowLike | null = null
  let action: 'updated' | 'updated_by_discord' | 'inserted' = 'updated'

  if (memberId) target = members.find((m) => cellString(m.cells[colID]).toLowerCase() === memberId.toLowerCase()) ?? null
  if (!isClaim && !target && discordId && colDiscord !== null) {
    target = members.find((m) => cellString(m.cells[colDiscord]) === discordId) ?? null
    if (target) action = 'updated_by_discord'
  }

  if (!target) {
    if (isClaim) return { ok: false, error: `Claim failed: Member ID ${memberId} not found.` }
    if (!memberId) return { ok: false, error: 'Insert requires memberId (refusing to create a blank-ID row).' }
    action = 'inserted'
  }

  if (action !== 'inserted' && raw.discordId !== undefined && !mayReassignDiscord && colDiscord !== null && target) {
    const currentDiscord = cellString(target.cells[colDiscord])
    if (currentDiscord && currentDiscord !== discordId) return { ok: false, error: 'DiscordId conflict: row is linked to a different Discord account.' }
  }

  const cells: MemberCells = Array.from({ length: headers.length }, (_, i) => (target?.cells[i] ? { ...target.cells[i]! } : null))
  const set = (col: number | null, cell: GvizCell) => {
    if (col !== null && col >= 0 && col < cells.length) cells[col] = cell
  }

  const name = String(raw.mafiaName ?? raw.name ?? '').trim()
  if (memberId) set(colID, asSheetValue(memberId))
  if (raw.mafiaName !== undefined || raw.name !== undefined) set(headerColumn(headers, 'Name'), { v: name })

  const colStatus = headerColumn(headers, 'Status')
  if (colStatus !== null && (!cellString(cells[colStatus]) || action === 'inserted')) set(colStatus, { v: DEFAULT_STATUS_ON_INSERT })

  if (raw.city !== undefined) set(headerColumn(headers, 'City'), { v: String(raw.city ?? '') })
  if (raw.crews !== undefined) set(headerColumn(headers, 'Crews'), { v: joinList(raw.crews || '') })
  if (raw.turtles !== undefined || raw.turtle !== undefined) {
    const t = Array.isArray(raw.turtles) ? raw.turtles.join(', ') : typeof raw.turtles === 'string' ? raw.turtles : String(raw.turtle || '')
    set(headerColumn(headers, 'Turtles'), { v: t })
  }
  if (raw.skills !== undefined) set(headerColumn(headers, 'Skills'), { v: String(raw.skills || '') })
  if (raw.discordId !== undefined) set(colDiscord, { v: String(raw.discordId || '') })
  if (raw.discordJoined !== undefined) set(headerColumn(headers, 'DiscordJoined'), { v: !!raw.discordJoined })
  if (raw.wallet !== undefined) set(headerColumn(headers, 'Wallet'), { v: String(raw.wallet || '') })
  if (raw.x !== undefined) set(headerColumn(headers, 'X'), { v: String(raw.x || '') })

  const colNotes = headerColumn(headers, 'Notes')
  if (colNotes !== null) {
    const cur = cellString(cells[colNotes])
    const idForNote = memberId || cellString(cells[colID]) || '(unknown)'
    const line = `[${nowIso}] ${isClaim ? 'Claimed' : 'Onboarded'}: ${name || '(no name provided)'} (ID: ${idForNote})`
    set(colNotes, { v: cur ? `${cur}\n${line}` : line })
  }

  const finalId = cellString(cells[colID])
  return { ok: true, action, targetId: finalId, previousId: target ? target.id : null, cells, id: memberId || '' }
}

/** The typed copies kept next to the cells, for lookups. */
export function memberIndexFields(headers: readonly string[], cells: MemberCells): { discordId: string | null; name: string } {
  const d = headerColumn(headers, 'DiscordId')
  const n = headerColumn(headers, 'Name')
  return { discordId: d !== null ? cellString(cells[d]) || null : null, name: n !== null ? cellString(cells[n]) : '' }
}
