/**
 * Live Discord message counting for the app's profile "Discord activity" block. The gateway delivers every
 * guild message (GuildMessages intent, not privileged; content is NOT read or kept: only who, which
 * channel and when). Counts are gathered in memory and sent to the app in batches every flushSeconds
 * (POST /api/calls/recorder/discord-activity, Bearer RECORDER_API_KEY, remote config
 * `discordActivity`). Fire and forget: nothing here can block or fail recording.
 *
 * Idempotency: each batch has an id and the app applies an id once. A batch whose answer was lost (timeout,
 * 5xx) is resent with the SAME id and contents; new counts go into the next batch. A restart loses what is
 * in memory (at most one interval of counting), never double counts.
 *
 * Keep the body in sync with app/lib/discord-activity.ts.
 */
import { randomUUID } from 'node:crypto'

export interface ActivityUserBatch {
  discordId: string
  authorName: string | null
  firstAt: string
  lastAt: string
  days: Record<string, number>
  channels: Record<string, number>
  replies: number
  threads: number
}
export interface ActivityBatchBody {
  batchId: string
  users: ActivityUserBatch[]
}

export interface ActivityEvent {
  discordId: string
  authorName: string | null
  atMs: number
  channelName: string
  reply: boolean
  thread: boolean
}

/** The part of a discord.js Message used here (so tests need no Discord objects). */
export interface MessageLike {
  guildId?: string | null
  author?: { id: string; bot?: boolean; username?: string } | null
  webhookId?: string | null
  system?: boolean
  type?: number
  createdTimestamp: number
  channel?: { name?: string | null; parent?: { name?: string | null } | null; isThread?: () => boolean } | null
}

/** MessageType.Reply */
const REPLY_TYPE = 19
/** MessageType.Default */
const DEFAULT_TYPE = 0

/** A countable server message from a person, or null (other guild, bot, webhook, system, DM). */
export function toActivityEvent(msg: MessageLike, guildId: string): ActivityEvent | null {
  if (!msg.guildId || msg.guildId !== guildId) return null
  if (!msg.author || msg.author.bot || msg.webhookId || msg.system) return null
  if (msg.type !== undefined && msg.type !== DEFAULT_TYPE && msg.type !== REPLY_TYPE) return null
  const ch = msg.channel
  const thread = !!ch?.isThread?.()
  const name = (thread ? ch?.parent?.name : ch?.name) ?? null
  return {
    discordId: msg.author.id,
    authorName: msg.author.username ? msg.author.username.slice(0, 100) : null,
    atMs: msg.createdTimestamp,
    channelName: name ? name.slice(0, 100) : '',
    reply: msg.type === REPLY_TYPE,
    thread,
  }
}

export const ACTIVITY_TIMEOUT_MS = 15_000
export const MAX_BATCH_USERS = 500
const MAX_CHANNELS_PER_USER = 50
/** Most distinct people waiting for a batch (a flood or a long outage never grows memory without bound). */
const MAX_PENDING_USERS = 20_000
/** A batch that still fails after this many sends is dropped. */
const MAX_SEND_TRIES = 12

export type ActivityPostResult = 'ok' | 'duplicate' | 'off' | 'error'

/** POST a batch. Never throws. */
export async function postActivityBatch(
  appBaseUrl: string,
  apiKey: string,
  body: ActivityBatchBody,
  log: (msg: string) => void,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = ACTIVITY_TIMEOUT_MS,
): Promise<ActivityPostResult> {
  try {
    const res = await fetchImpl(`${appBaseUrl}/api/calls/recorder/discord-activity`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (res.status === 204) return 'off'
    // A request the app rejects as invalid will never succeed: drop it instead of retrying forever.
    if (res.status === 400) {
      log('discord activity: app rejected the batch (400); dropping it')
      return 'duplicate'
    }
    if (!res.ok) {
      log(`discord activity: app answered ${res.status}`)
      return 'error'
    }
    const j = (await res.json().catch(() => null)) as { status?: string } | null
    return j?.status === 'duplicate' ? 'duplicate' : 'ok'
  } catch (err) {
    log(`discord activity: request failed (${err instanceof Error ? err.message : String(err)})`)
    return 'error'
  }
}

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export interface ActivityCounterDeps {
  post: (body: ActivityBatchBody) => Promise<ActivityPostResult>
  /** Current remote config values (read each time, so a settings change applies without a restart). */
  config: () => { enabled: boolean; flushSeconds: number }
  log?: (msg: string) => void
  newId?: () => string
}

export class ActivityCounter {
  private pending = new Map<string, ActivityUserBatch>()
  private inflight: { body: ActivityBatchBody; tries: number } | null = null
  private timer: NodeJS.Timeout | null = null
  private flushing = false
  private loggedStart = false
  private readonly newId: () => string

  constructor(private readonly d: ActivityCounterDeps) {
    this.newId = d.newId ?? (() => randomUUID())
  }

  /** Count one message (only while counting is on). */
  add(e: ActivityEvent): void {
    if (!this.d.config().enabled) return
    if (!this.loggedStart) {
      this.loggedStart = true
      // The backfill script's --until: messages before this are not counted here.
      this.d.log?.(`discord activity: live counting began with a message at ${new Date(e.atMs).toISOString()}`)
    }
    let u = this.pending.get(e.discordId)
    if (!u) {
      if (this.pending.size >= MAX_PENDING_USERS) return
      u = { discordId: e.discordId, authorName: e.authorName, firstAt: new Date(e.atMs).toISOString(), lastAt: new Date(e.atMs).toISOString(), days: {}, channels: {}, replies: 0, threads: 0 }
      this.pending.set(e.discordId, u)
    }
    const iso = new Date(e.atMs).toISOString()
    if (iso < u.firstAt) u.firstAt = iso
    if (iso >= u.lastAt) {
      u.lastAt = iso
      if (e.authorName) u.authorName = e.authorName
    }
    const day = dayOf(e.atMs)
    u.days[day] = (u.days[day] ?? 0) + 1
    if (e.channelName && (u.channels[e.channelName] !== undefined || Object.keys(u.channels).length < MAX_CHANNELS_PER_USER)) {
      u.channels[e.channelName] = (u.channels[e.channelName] ?? 0) + 1
    }
    if (e.reply) u.replies++
    if (e.thread) u.threads++
  }

  get pendingUsers(): number {
    return this.pending.size
  }

  /** Start the periodic flush (interval re-read from the config after every run). */
  start(): void {
    if (this.timer) return
    const loop = () => {
      const secs = Math.min(3600, Math.max(60, this.d.config().flushSeconds))
      this.timer = setTimeout(async () => {
        await this.flush()
        if (this.timer) loop()
      }, secs * 1000)
      this.timer.unref?.()
    }
    loop()
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  /** Send the unacknowledged batch (same id), then up to one new batch. Never throws. */
  async flush(): Promise<void> {
    if (this.flushing) return
    this.flushing = true
    try {
      if (!this.d.config().enabled) {
        this.pending.clear()
        this.inflight = null
        return
      }
      if (this.inflight) {
        if (!(await this.send(this.inflight))) return
      }
      if (this.pending.size === 0) return
      const users: ActivityUserBatch[] = []
      for (const [id, u] of this.pending) {
        users.push(u)
        this.pending.delete(id)
        if (users.length >= MAX_BATCH_USERS) break
      }
      this.inflight = { body: { batchId: this.newId(), users }, tries: 0 }
      await this.send(this.inflight)
    } catch (err) {
      this.d.log?.(`discord activity flush failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      this.flushing = false
    }
  }

  /** True when the batch is settled (acknowledged, a duplicate, switched off, or given up on). */
  private async send(b: { body: ActivityBatchBody; tries: number }): Promise<boolean> {
    b.tries++
    const res = await this.d.post(b.body)
    if (res === 'error') {
      if (b.tries >= MAX_SEND_TRIES) {
        this.d.log?.('discord activity: dropping a batch after repeated failures')
        this.inflight = null
        return true
      }
      return false
    }
    this.inflight = null
    if (res === 'off') this.pending.clear()
    return true
  }
}
