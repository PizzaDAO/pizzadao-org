/**
 * The per-session manifest (manifest.jsonl): one JSON record per line, appended
 * as the call goes so a crash loses nothing already written. `summarize` is pure.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { IngestChatMessage, IngestPresence, ManifestRecord, SegmentRecord } from './types.js'

export const MANIFEST_FILE = 'manifest.jsonl'

export function appendRecord(dir: string, record: ManifestRecord): void {
  appendFileSync(path.join(dir, MANIFEST_FILE), `${JSON.stringify(record)}\n`)
}

export function readManifest(dir: string): ManifestRecord[] {
  const file = path.join(dir, MANIFEST_FILE)
  if (!existsSync(file)) return []
  const out: ManifestRecord[] = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line) as ManifestRecord)
    } catch {
      // a torn last line after a crash
    }
  }
  return out
}

export interface SpeakerSummary {
  userId: string
  displayName: string | null
  talkTimeSec: number
  segments: SegmentRecord[]
}

/** Per-speaker segments and talk time. Purged users and empty segments are dropped. */
export function summarize(records: ManifestRecord[]): SpeakerSummary[] {
  const purged = new Set(records.filter((r) => r.t === 'purge').map((r) => r.userId))
  const names = new Map<string, string>()
  const byUser = new Map<string, SegmentRecord[]>()
  for (const r of records) {
    if (r.t === 'member') names.set(r.userId, r.displayName)
    else if (r.t === 'segment' && !purged.has(r.userId) && r.bytes > 0) {
      const list = byUser.get(r.userId) ?? []
      list.push(r)
      byUser.set(r.userId, list)
    }
  }
  return [...byUser.entries()]
    .map(([userId, segments]) => ({
      userId,
      displayName: names.get(userId) ?? null,
      talkTimeSec: Math.round(segments.reduce((sum, s) => sum + Math.max(0, s.endMs - s.startMs), 0) / 1000),
      segments: segments.sort((a, b) => a.startMs - b.startMs),
    }))
    .sort((a, b) => b.talkTimeSec - a.talkTimeSec)
}

/** Everyone seen in the voice channel during the session (purged users dropped), sorted. */
export function participantIds(records: ManifestRecord[]): string[] {
  const purged = new Set(records.filter((r) => r.t === 'purge').map((r) => r.userId))
  const ids = new Set<string>()
  for (const r of records) if (r.t === 'present') for (const id of r.userIds) if (!purged.has(id)) ids.add(id)
  return [...ids].sort()
}

export interface PresenceStat {
  userId: string
  /** Whole seconds in the channel; null when only the old first-seen records exist (no duration known). */
  presentSec: number | null
  firstSeenMs: number
  lastSeenMs: number
}

/**
 * Time in the channel per person, from the `presence` records (full member set at each change).
 * The last set runs until `endMs`; a record after `endMs` is ignored. Purged users are dropped. Sessions
 * recorded before presence records existed fall back to the first-seen `present` records (presentSec null,
 * seen times unknown, reported as 0). Pure; a torn last line was already dropped by readManifest.
 */
export function presenceStats(records: ManifestRecord[], endMs: number): PresenceStat[] {
  const purged = new Set(records.filter((r) => r.t === 'purge').map((r) => r.userId))
  const marks = records
    .filter((r): r is Extract<ManifestRecord, { t: 'presence' }> => r.t === 'presence')
    .map((r) => ({ atMs: r.atMs, userIds: r.userIds }))
    .sort((a, b) => a.atMs - b.atMs)
  if (marks.length === 0) {
    return participantIds(records).map((userId) => ({ userId, presentSec: null, firstSeenMs: 0, lastSeenMs: 0 }))
  }
  const acc = new Map<string, { ms: number; first: number; last: number }>()
  marks.forEach((m, i) => {
    if (m.atMs >= endMs) return
    const from = m.atMs
    const to = Math.min(i + 1 < marks.length ? marks[i + 1].atMs : endMs, endMs)
    const len = Math.max(0, to - from)
    for (const id of new Set(m.userIds)) {
      if (purged.has(id)) continue
      const a = acc.get(id) ?? { ms: 0, first: from, last: from }
      a.ms += len
      a.last = Math.max(a.last, Math.max(from, to))
      acc.set(id, a)
    }
  })
  // Anyone only in old-style records (a restart mid-call) is still known to have been there.
  for (const id of participantIds(records)) if (!acc.has(id)) acc.set(id, { ms: 0, first: marks[0].atMs, last: marks[0].atMs })
  return [...acc.entries()]
    .map(([userId, a]) => ({ userId, presentSec: Math.round(a.ms / 1000), firstSeenMs: a.first, lastSeenMs: a.last }))
    .sort((a, b) => a.userId.localeCompare(b.userId))
}

export const MAX_PRESENCE = 300

/** The ingest `presence` list: relative times, capped, longest stays first when over the cap. */
export function ingestPresence(stats: PresenceStat[], startedAtMs: number): IngestPresence[] {
  return stats
    .filter((s) => s.presentSec !== null)
    .map((s) => ({
      discordId: s.userId,
      presentSec: s.presentSec as number,
      firstSeenMs: Math.max(0, Math.round(s.firstSeenMs - startedAtMs)),
      lastSeenMs: Math.max(0, Math.round(s.lastSeenMs - startedAtMs)),
    }))
    .sort((a, b) => b.presentSec - a.presentSec || a.discordId.localeCompare(b.discordId))
    .slice(0, MAX_PRESENCE)
}

export const MAX_CHAT_MESSAGES = 5000
export const MAX_CHAT_TEXT = 4000
/** Total chat text kept per call (earliest messages win); keeps the ingest body well under the host's request limit. */
export const MAX_CHAT_TOTAL_CHARS = 1_000_000
export const MIN_CHAT_FOR_TEXT_ONLY = 3

/**
 * The chat to report: latest edit of each message, deleted ones dropped, purged users' messages
 * dropped, empty text dropped, in time order, capped.
 */
export function chatMessages(records: ManifestRecord[]): IngestChatMessage[] {
  const purged = new Set(records.filter((r) => r.t === 'purge').map((r) => r.userId))
  const byId = new Map<string, IngestChatMessage>()
  for (const r of records) {
    if (r.t === 'chat') {
      byId.set(r.messageId, { discordId: r.userId, displayName: r.displayName || null, text: r.text, atMs: r.atMs, messageId: r.messageId })
    } else if (r.t === 'chat-edit') {
      const m = byId.get(r.messageId)
      if (m) m.text = r.text
    } else if (r.t === 'chat-delete') {
      byId.delete(r.messageId)
    }
  }
  const sorted = [...byId.values()]
    .filter((m) => !purged.has(m.discordId))
    .map((m) => ({ ...m, text: m.text.trim().slice(0, MAX_CHAT_TEXT) }))
    .filter((m) => m.text)
    .sort((a, b) => a.atMs - b.atMs)
    .slice(0, MAX_CHAT_MESSAGES)
  let total = 0
  const kept: IngestChatMessage[] = []
  for (const m of sorted) {
    total += m.text.length
    if (total > MAX_CHAT_TOTAL_CHARS) break
    kept.push(m)
  }
  return kept
}
