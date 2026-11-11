/**
 * Action items confirmed during the call (plans/post-call-agenda-updates.md, options A and C).
 *
 * - Speech (A): every `chunkSeconds` the speech segments finished since the last cut are uploaded to
 *   R2 (under the session prefix, so finalize prunes them) and the app is asked to transcribe them
 *   and look for new action items: POST /api/calls/recorder/live-chunk.
 * - Chat (C): a chat message starting with a configured prefix ("action: ...") is sent to the app
 *   right away (batched for a few seconds).
 *
 * The app decides everything that matters (crew allowlist, private post filters, dedupe, caps) and
 * answers with the messages to post, already worded. This side only posts them in the voice channel's
 * chat, at most one post per MIN_POST_GAP_MS for chat, and never after the session stopped.
 * The recorder has no OpenAI key and no filter values. Every failure is logged and dropped: the
 * post-call summary still picks the items up.
 */
import path from 'node:path'
import type { RemoteConfig } from './remote-config.js'
import { sessionKeys, type Uploader } from './storage.js'
import type { SegmentRecord } from './types.js'

/** One speech burst sent to the app (times are ms since the session started). */
export interface LiveSegment {
  discordId: string
  displayName: string | null
  key: string
  startMs: number
  endMs: number
}

export interface LiveChat {
  discordId: string
  displayName: string | null
  messageId: string
  text: string
  atMs: number
}

/** Body of POST /api/calls/recorder/live-chunk. Keep in sync with app/lib/calls/live-items.ts. */
export interface LiveRequest {
  sessionId: string
  eventId: string | null
  eventName: string | null
  startedAt: string
  /** Speech chunk number (idempotency on the app side); absent for chat-only requests. */
  seq?: number
  /** 'play-out': the app only checks the bursts for the spoken play-out command (play-out.ts). */
  command?: 'play-out'
  segments?: LiveSegment[]
  chat?: LiveChat[]
}

/** Segments shorter than this are not sent (coughs, clicks). */
export const MIN_SEGMENT_MS = 400
/** At most this many segments per chunk; the rest wait for the next cut. */
export const MAX_SEGMENTS_PER_CHUNK = 250
/** Chat items typed within this window go out in one request. */
export const CHAT_BATCH_MS = 3_000
/** Chat confirmations are at least this far apart. */
export const MIN_POST_GAP_MS = 10_000
/** The app transcribes and runs a model: give it time. */
export const LIVE_REQUEST_TIMEOUT_MS = 110_000

/** The item text of a chat message that starts with one of the prefixes (case-insensitive), else null. */
export function chatActionText(text: string, prefixes: readonly string[]): string | null {
  const t = text.trim()
  const lower = t.toLowerCase()
  for (const p of prefixes) {
    if (!p || !lower.startsWith(p)) continue
    const rest = t.slice(p.length).trim()
    return rest.length >= 3 ? rest : null
  }
  return null
}

/** POST to the app; returns the messages to post (an empty list on any failure). Never throws. */
export async function postLive(
  appBaseUrl: string,
  apiKey: string,
  body: LiveRequest,
  log: (msg: string) => void,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  try {
    const res = await fetchImpl(`${appBaseUrl}/api/calls/recorder/live-chunk`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(LIVE_REQUEST_TIMEOUT_MS),
    })
    if (!res.ok) {
      log(`live items: app answered ${res.status}`)
      return []
    }
    const json = (await res.json()) as { messages?: unknown }
    return Array.isArray(json.messages) ? json.messages.filter((m): m is string => typeof m === 'string' && m.trim().length > 0).map((m) => m.slice(0, 1900)).slice(0, 3) : []
  } catch (err) {
    log(`live items: request failed (${err instanceof Error ? err.message : String(err)})`)
    return []
  }
}

export interface LiveItemsDeps {
  sessionId: string
  eventId: string | null
  eventName: string | null
  startedAtMs: number
  /** Session directory (segment files are relative to it). */
  dir: string
  cfg: RemoteConfig['liveItems']
  uploader: Pick<Uploader, 'put'>
  /** Keys already in R2 (uploaded by the play-out fast path): not uploaded again. */
  uploaded?: ReadonlySet<string>
  post: (body: LiveRequest) => Promise<string[]>
  send: (text: string) => Promise<boolean>
  nameOf: (userId: string) => string | null
  log: (msg: string) => void
  now?: () => number
}

export class LiveItems {
  private pending: SegmentRecord[] = []
  private chatQueue: LiveChat[] = []
  private chatTimer: NodeJS.Timeout | null = null
  private cutTimer: NodeJS.Timeout | null = null
  private cutting = false
  private chatting = false
  private stopped = false
  private seq = 0
  private lastChatPostMs = 0
  private readonly now: () => number

  constructor(private readonly d: LiveItemsDeps) {
    this.now = d.now ?? Date.now
  }

  get audio(): boolean {
    return this.d.cfg.audio
  }

  get chat(): boolean {
    return this.d.cfg.chat
  }

  start(): void {
    if (!this.d.cfg.audio || this.cutTimer) return
    this.cutTimer = setInterval(() => void this.cut(), this.d.cfg.chunkSeconds * 1000)
    this.cutTimer.unref?.()
  }

  /** A finished speech segment (from the capture). */
  onSegment(rec: SegmentRecord): void {
    if (this.stopped || !this.d.cfg.audio) return
    if (rec.bytes <= 0 || rec.endMs - rec.startMs < MIN_SEGMENT_MS) return
    this.pending.push(rec)
  }

  /** A chat message typed in the call (already captured for the transcript). */
  onChat(c: LiveChat): void {
    if (this.stopped || !this.d.cfg.chat) return
    if (chatActionText(c.text, this.d.cfg.prefixes) === null) return
    this.chatQueue.push(c)
    this.scheduleChat()
  }

  private scheduleChat(): void {
    if (this.chatTimer || this.chatting) return
    const at = Math.max(this.now() + CHAT_BATCH_MS, this.lastChatPostMs + MIN_POST_GAP_MS)
    this.chatTimer = setTimeout(() => void this.flushChat(), Math.max(0, at - this.now()))
    this.chatTimer.unref?.()
  }

  private base(): Omit<LiveRequest, 'segments' | 'chat' | 'seq'> {
    return { sessionId: this.d.sessionId, eventId: this.d.eventId, eventName: this.d.eventName, startedAt: new Date(this.d.startedAtMs).toISOString() }
  }

  /** Send the queued chat items; their confirmations are posted unless the session stopped meanwhile. */
  async flushChat(): Promise<void> {
    this.chatTimer = null
    if (this.stopped || this.chatting || this.chatQueue.length === 0) return
    this.chatting = true
    try {
      const chat = this.chatQueue.splice(0, 20)
      const messages = await this.d.post({ ...this.base(), chat })
      await this.postAll(messages)
      if (messages.length) this.lastChatPostMs = this.now()
    } finally {
      this.chatting = false
      if (this.chatQueue.length && !this.stopped) this.scheduleChat()
    }
  }

  /** Upload the segments finished since the last cut and ask the app for new action items. */
  async cut(): Promise<void> {
    if (this.stopped || this.cutting || this.pending.length === 0) return
    this.cutting = true
    try {
      const take = this.pending.splice(0, MAX_SEGMENTS_PER_CHUNK)
      const keys = sessionKeys(this.d.sessionId)
      const segments: LiveSegment[] = []
      for (const rec of take) {
        if (this.stopped) return
        const key = keys.live(rec.userId, rec.startMs)
        try {
          if (!this.d.uploaded?.has(key)) await this.d.uploader.put(key, path.join(this.d.dir, rec.file), 'audio/ogg')
          segments.push({ discordId: rec.userId, displayName: this.d.nameOf(rec.userId), key, startMs: rec.startMs, endMs: rec.endMs })
        } catch (err) {
          this.d.log(`live items: upload failed (${err instanceof Error ? err.message : String(err)}); skipping one segment`)
        }
      }
      if (segments.length === 0 || this.stopped) return
      const messages = await this.d.post({ ...this.base(), seq: ++this.seq, segments })
      await this.postAll(messages)
    } finally {
      this.cutting = false
    }
  }

  private async postAll(messages: string[]): Promise<void> {
    // The call ended while the app was thinking: the channel may belong to the next call now.
    for (const m of messages) if (!this.stopped) await this.d.send(m)
  }

  /** The session is ending: nothing more is sent or posted. */
  stop(): void {
    this.stopped = true
    if (this.cutTimer) clearInterval(this.cutTimer)
    if (this.chatTimer) clearTimeout(this.chatTimer)
    this.cutTimer = null
    this.chatTimer = null
    this.pending = []
    this.chatQueue = []
  }
}
