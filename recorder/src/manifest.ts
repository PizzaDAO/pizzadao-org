/**
 * The per-session manifest (manifest.jsonl): one JSON record per line, appended
 * as the call goes so a crash loses nothing already written. `summarize` is pure.
 */
import { appendFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import type { ManifestRecord, SegmentRecord } from './types.js'

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
