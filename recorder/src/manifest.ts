/**
 * The per-session manifest (manifest.jsonl): one JSON record per line, appended
 * as the call goes so a crash loses nothing already written. `summarize` is pure.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { IngestChatMessage, ManifestRecord, SegmentRecord } from './types.js'

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
