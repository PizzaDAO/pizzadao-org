/**
 * Payload for POST {APP_BASE_URL}/api/calls/recorder/ingest. Keep in sync with
 * app/lib/calls/ingest-schema.ts (the app validates it; R2 keys must live under
 * `calls/<sessionId>/`).
 */
export interface IngestSpeaker {
  discordId: string
  displayName: string | null
  talkTimeSec: number
  trackKey: string | null
  trackBytes: number | null
}

export interface IngestPayload {
  sessionId: string
  eventId: string | null
  eventName: string | null
  channelId: string
  startedAt: string
  endedAt: string
  endReason: string
  partial: boolean
  mix: { key: string; bytes: number } | null
  speakers: IngestSpeaker[]
}

/** Written to <session dir>/session.json when a recording starts, updated as it ends. */
export interface SessionMeta {
  sessionId: string
  eventId: string | null
  eventName: string | null
  channelId: string
  startedAtMs: number
  endedAtMs: number | null
  endReason: string | null
  partial: boolean
}

export interface SegmentRecord {
  t: 'segment'
  userId: string
  startMs: number
  endMs: number
  /** Path relative to the session dir. */
  file: string
  bytes: number
}

export interface MemberRecord {
  t: 'member'
  userId: string
  displayName: string
}

export interface PurgeRecord {
  t: 'purge'
  userId: string
}

export type ManifestRecord = SegmentRecord | MemberRecord | PurgeRecord
