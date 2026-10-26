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

export interface TranscriptSegment {
  discordId: string
  startMs: number
  endMs: number
  text: string
}

/** A message posted in the voice channel's text chat during the recording. */
export interface IngestChatMessage {
  discordId: string
  displayName: string | null
  text: string
  /** Milliseconds since the session started. */
  atMs: number
  messageId: string
}

export interface IngestTranscript {
  language: string | null
  segments: TranscriptSegment[]
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
  /** Omitted when there is no Deepgram key or nothing could be transcribed. */
  transcript?: IngestTranscript
  /** Voice-channel text chat during the call, in time order. Omitted when there was none. */
  chat?: IngestChatMessage[]
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

/** A chat message (append-only; later edits/deletes are separate records). */
export interface ChatRecord {
  t: 'chat'
  messageId: string
  userId: string
  displayName: string
  text: string
  atMs: number
}

export interface ChatEditRecord {
  t: 'chat-edit'
  messageId: string
  text: string
}

export interface ChatDeleteRecord {
  t: 'chat-delete'
  messageId: string
}

export type ManifestRecord = SegmentRecord | MemberRecord | PurgeRecord | ChatRecord | ChatEditRecord | ChatDeleteRecord
