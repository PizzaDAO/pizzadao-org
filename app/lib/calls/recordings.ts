/**
 * Call recordings: ingest (worker), review queries (/admin/calls), opt-outs.
 * Audio is private; see r2.ts and retention.ts.
 */
import { prisma } from '@/app/lib/db'
import { getCrewMappings } from '@/app/lib/crew-mappings'
import { resolveCrewForEvent, type CrewRef } from './crew-map'
import type { IngestPayload } from './ingest-schema'

/**
 * Crew list for event -> crew mapping. A sheet outage must not lose a
 * recording, so failures fall back to "no crew" (the review page still shows
 * the event name).
 */
async function loadCrews(): Promise<CrewRef[]> {
  try {
    const { crews } = await getCrewMappings()
    return crews.map((c) => ({ id: c.id, label: c.label, event: c.event }))
  } catch (err) {
    console.error('[calls/ingest] crew mappings unavailable:', err)
    return []
  }
}

/**
 * Store a recording. Idempotent on sessionId: a retry of an already-stored
 * session returns the existing row untouched (so a reviewer's status changes
 * are never clobbered by a worker retry).
 */
export async function ingestRecording(p: IngestPayload): Promise<{ id: string; duplicate: boolean }> {
  const existing = await prisma.callRecording.findUnique({ where: { sessionId: p.sessionId }, select: { id: true } })
  if (existing) return { id: existing.id, duplicate: true }

  const crew = resolveCrewForEvent(await loadCrews(), { eventId: p.eventId, eventName: p.eventName })
  const created = await prisma.callRecording.create({
    data: {
      sessionId: p.sessionId,
      discordEventId: p.eventId,
      eventName: p.eventName,
      crewId: crew?.crewId ?? null,
      crewLabel: crew?.crewLabel ?? null,
      channelId: p.channelId,
      startedAt: p.startedAt,
      endedAt: p.endedAt,
      durationSec: Math.max(0, Math.round((p.endedAt.getTime() - p.startedAt.getTime()) / 1000)),
      endReason: p.endReason,
      partial: p.partial,
      mixKey: p.mix?.key ?? null,
      mixBytes: p.mix?.bytes ?? null,
      speakers: {
        create: p.speakers.map((s) => ({
          discordId: s.discordId,
          displayName: s.displayName,
          talkTimeSec: s.talkTimeSec,
          trackKey: s.trackKey,
          trackBytes: s.trackBytes,
        })),
      },
    },
    select: { id: true },
  })
  return { id: created.id, duplicate: false }
}

export async function listRecordings(take = 100) {
  return prisma.callRecording.findMany({
    orderBy: { startedAt: 'desc' },
    take,
    select: {
      id: true,
      status: true,
      eventName: true,
      crewId: true,
      crewLabel: true,
      startedAt: true,
      durationSec: true,
      partial: true,
      audioDeletedAt: true,
      _count: { select: { speakers: true } },
    },
  })
}

export async function getRecording(id: string) {
  return prisma.callRecording.findUnique({
    where: { id },
    include: { speakers: { orderBy: { talkTimeSec: 'desc' } } },
  })
}

/** Discord ids the worker must never record. */
export async function listOptOutIds(): Promise<string[]> {
  const rows = await prisma.recordingOptOut.findMany({ select: { discordId: true } })
  return rows.map((r) => r.discordId)
}

/** /record optout (true) and /record optin (false). Both are idempotent. */
export async function setRecordingOptOut(discordId: string, optedOut: boolean): Promise<void> {
  if (optedOut) {
    await prisma.recordingOptOut.upsert({ where: { discordId }, create: { discordId }, update: {} })
  } else {
    await prisma.recordingOptOut.deleteMany({ where: { discordId } })
  }
}
