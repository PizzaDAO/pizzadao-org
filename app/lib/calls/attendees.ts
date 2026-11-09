/**
 * Who attended a published call, for the public call page (signed-in members only).
 *
 * Source, in order: CallAttendance rows for the recording's crew and day (canonical crew via the alias
 * setting), else the recording's measured CallPresence, else its speakers. Reviewer-redacted speakers
 * are removed from every source. Imported (non-Discord) calls show speaker labels only, never linked.
 * No minutes are returned (those stay admin-only) and linkedDiscordId is never read.
 */
import { prisma } from '@/app/lib/db'
import { resolvePfpUrlsAsync } from '@/app/lib/pfp'
import { attendanceCrewId, crewIdsFor, loadCrewAliases } from './crew-alias'
import { callDay } from './attendance-from-recordings'
import { isImportedSource } from './imported'
import { displaySpeakerName } from './speaker-labels'

const DISCORD_ID = /^\d{17,20}$/

export interface Attendee {
  name: string
  /** App member id for /profile/<memberId>; null for non-members and imported speakers. */
  memberId: string | null
  pfpUrl: string | null
}

export interface AttendeeRecording {
  id: string
  crewId: string | null
  startedAt: Date
  source: string | null
  speakers: Array<{ discordId: string; displayName: string | null }>
}

export interface AttendeeText {
  speakerN: (n: number) => string
  fallback: string
}

interface Raw {
  discordId: string
  displayName: string | null
}

export async function loadCallAttendees(rec: AttendeeRecording, text: AttendeeText): Promise<Attendee[]> {
  try {
    const row = await prisma.callRecording.findUnique({ where: { id: rec.id }, select: { redactedSpeakerIds: true } })
    const hidden = new Set(row?.redactedSpeakerIds ?? [])
    const speakers = rec.speakers.filter((s) => !hidden.has(s.discordId))

    if (isImportedSource(rec.source)) {
      // Diarized speakers: names only, no links (linked member ids are never public).
      return speakers.map((s) => ({ name: displaySpeakerName(s.discordId, s.displayName, text), memberId: null, pfpUrl: null }))
    }

    let raw: Raw[] = []
    if (rec.crewId) {
      const aliases = await loadCrewAliases()
      const crews = crewIdsFor(attendanceCrewId(rec.crewId, aliases), aliases)
      raw = await prisma.callAttendance.findMany({
        where: { crewId: { in: crews }, callDate: callDay(rec.startedAt) },
        select: { discordId: true, displayName: true },
      })
    }
    if (raw.length === 0) {
      raw = await prisma.callPresence.findMany({ where: { recordingId: rec.id }, select: { discordId: true, displayName: true } })
    }
    if (raw.length === 0) raw = speakers
    // Dedupe, drop redacted people and anything that is not a Discord user id.
    const byId = new Map<string, string | null>()
    for (const r of raw) {
      if (hidden.has(r.discordId) || !DISCORD_ID.test(r.discordId)) continue
      if (!byId.get(r.discordId)) byId.set(r.discordId, r.displayName?.trim() || null)
    }
    if (byId.size === 0) return []

    const members = await prisma.member.findMany({ where: { discordId: { in: [...byId.keys()] } }, select: { id: true, discordId: true, name: true } })
    const memberOf = new Map<string, { id: string; name: string }>()
    for (const m of members) if (m.discordId && !memberOf.has(m.discordId)) memberOf.set(m.discordId, { id: m.id, name: m.name })
    const pfps: Record<string, string | null> = await resolvePfpUrlsAsync([...memberOf.values()].map((m) => m.id)).catch(() => ({}))

    const out: Attendee[] = [...byId].map(([discordId, display]) => {
      const m = memberOf.get(discordId)
      if (m) return { name: m.name.trim() || display || text.fallback, memberId: m.id, pfpUrl: pfps[m.id] ?? null }
      return { name: display || text.fallback, memberId: null, pfpUrl: null }
    })
    // Members first, then A to Z.
    return out.sort((a, b) => Number(!!b.memberId) - Number(!!a.memberId) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  } catch (err) {
    console.error('[calls/attendees] unavailable:', err instanceof Error ? err.message : err)
    return []
  }
}
