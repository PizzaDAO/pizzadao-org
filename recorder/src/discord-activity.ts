/**
 * Live Discord message counting for the app's profile "Discord activity" block. The gateway delivers every
 * guild message (GuildMessages intent, not privileged; content is NOT read or kept: only who, which
 * channel and when). Counts are gathered in memory and sent to the app in batches every flushSeconds
 * (POST /api/calls/recorder/discord-activity, Bearer RECORDER_API_KEY, remote config
 * `discordActivity`). Fire and forget: nothing here can block or fail recording.
 *
 * Idempotency: each batch has an id and the app applies an id once. A batch whose answer was lost (timeout,
 * 5xx, network error) is resent with the SAME id and contents, however long that takes (a 2-day app outage
 * once silently dropped 2 days of counts, so a batch is never given up on for a transient failure); new
 * counts keep accumulating in `pending` meanwhile and go into the next batch. Only a batch the app rejects
 * as invalid (400/422) is dropped. The in-flight batch is persisted to DATA_DIR (when given) so a restart
 * does not lose it; counts still in `pending` at a restart are lost (at most one interval), never double
 * counted.
 *
 * Keep the body in sync with app/lib/discord-activity.ts.
 */
import { randomUUID } from 'node:crypto'
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'

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
/** Log a stuck batch as an error after this many consecutive failed tries, then at most once per LOG_EVERY_MS. */
export const WARN_AFTER_TRIES = 3
export const LOG_EVERY_MS = 3_600_000

/** 'rejected' = the app says the batch is invalid (400/422): it will never succeed, so it is dropped. */
export type ActivityPostResult = 'ok' | 'duplicate' | 'off' | 'rejected' | 'error'
export interface ActivityPostOutcome {
  result: ActivityPostResult
  /** HTTP status, or a short reason ("timeout", "network error") for a failed try. */
  status?: string
}

/** POST a batch. Never throws. */
export async function postActivityBatch(
  appBaseUrl: string,
  apiKey: string,
  body: ActivityBatchBody,
  log: (msg: string) => void,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = ACTIVITY_TIMEOUT_MS,
): Promise<ActivityPostResult> {
  return (await postActivityBatchDetailed(appBaseUrl, apiKey, body, log, fetchImpl, timeoutMs)).result
}

/** Like postActivityBatch, but also says what went wrong. Never throws. */
export async function postActivityBatchDetailed(
  appBaseUrl: string,
  apiKey: string,
  body: ActivityBatchBody,
  log: (msg: string) => void,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = ACTIVITY_TIMEOUT_MS,
): Promise<ActivityPostOutcome> {
  try {
    const res = await fetchImpl(`${appBaseUrl}/api/calls/recorder/discord-activity`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (res.status === 204) return { result: 'off' }
    // A batch the app rejects as invalid will never succeed: drop it instead of retrying forever.
    if (res.status === 400 || res.status === 422) {
      log(`discord activity: app rejected the batch (${res.status}); dropping it`)
      return { result: 'rejected', status: String(res.status) }
    }
    if (!res.ok) {
      // 401/403/404 are misconfiguration (wrong RECORDER_API_KEY, route not deployed): retried, never dropped.
      log(`discord activity: app answered ${res.status}${[401, 403, 404].includes(res.status) ? ' (misconfiguration? check RECORDER_API_KEY / app deploy); the batch is kept and retried' : ''}`)
      return { result: 'error', status: String(res.status) }
    }
    const j = (await res.json().catch(() => null)) as { status?: string } | null
    return { result: j?.status === 'duplicate' ? 'duplicate' : 'ok' }
  } catch (err) {
    log(`discord activity: request failed (${err instanceof Error ? err.message : String(err)})`)
    return { result: 'error', status: err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError') ? 'timeout' : 'network error' }
  }
}

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export interface ActivityCounterDeps {
  post: (body: ActivityBatchBody) => Promise<ActivityPostResult | ActivityPostOutcome>
  /** Current remote config values (read each time, so a settings change applies without a restart). */
  config: () => { enabled: boolean; flushSeconds: number }
  log?: (msg: string) => void
  newId?: () => string
  /** Clock (ms), injectable for tests. */
  now?: () => number
  /** File (in DATA_DIR) the in-flight batch is persisted to, so a restart does not lose it. Optional. */
  stateFile?: string
}

export class ActivityCounter {
  private pending = new Map<string, ActivityUserBatch>()
  private inflight: { body: ActivityBatchBody; tries: number } | null = null
  private timer: NodeJS.Timeout | null = null
  private flushing = false
  private loggedStart = false
  /** Last "counting on/off, every Ns" state logged (logged at start and whenever the settings change it). */
  private loggedState = ''
  private readonly newId: () => string
  private readonly now: () => number
  /** When the stuck-batch error line was last logged (-Infinity = not yet for the current failure streak). */
  private lastWarnAt = -Infinity
  /** New-person messages discarded at the MAX_PENDING_USERS cap (running total, shown in the log line). */
  private discarded = 0
  private lastDiscardLogAt = -Infinity

  constructor(private readonly d: ActivityCounterDeps) {
    this.newId = d.newId ?? (() => randomUUID())
    this.now = d.now ?? Date.now
    this.load()
  }

  private load(): void {
    if (!this.d.stateFile) return
    try {
      const parsed = JSON.parse(readFileSync(this.d.stateFile, 'utf8')) as { body?: ActivityBatchBody; tries?: number } | null
      if (parsed?.body && typeof parsed.body.batchId === 'string' && Array.isArray(parsed.body.users)) {
        this.inflight = { body: parsed.body, tries: typeof parsed.tries === 'number' ? parsed.tries : 0 }
        this.d.log?.(`discord activity: restored unsent batch ${parsed.body.batchId.slice(0, 8)} with ${parsed.body.users.length} user(s) from disk`)
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') this.d.log?.(`discord activity: could not read ${this.d.stateFile}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** Persist the in-flight batch (or remove the file when there is none). Never throws. */
  private save(): void {
    const f = this.d.stateFile
    if (!f) return
    try {
      if (!this.inflight) {
        rmSync(f, { force: true })
        return
      }
      writeFileSync(`${f}.tmp`, JSON.stringify({ body: this.inflight.body, tries: this.inflight.tries }))
      renameSync(`${f}.tmp`, f)
    } catch (err) {
      this.d.log?.(`discord activity: could not persist the in-flight batch: ${err instanceof Error ? err.message : String(err)}`)
    }
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
      if (this.pending.size >= MAX_PENDING_USERS) {
        // Counts for new people are lost here (people already pending keep counting). Only reachable while
        // batches are not draining (a long outage) or in a flood: say so, at most once an hour.
        this.discarded++
        const t = this.now()
        if (t - this.lastDiscardLogAt >= LOG_EVERY_MS) {
          this.lastDiscardLogAt = t
          this.d.log?.(`discord activity: ERROR pending is full (${MAX_PENDING_USERS} users); discarded counts for ${this.discarded} new user message(s) so far. Is the app unreachable?`)
        }
        return
      }
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
      const cfg = this.d.config()
      const secs = Math.min(3600, Math.max(60, cfg.flushSeconds))
      const state = `counting ${cfg.enabled ? 'on' : 'off'}, flushing every ${secs}s`
      if (state !== this.loggedState) {
        this.loggedState = state
        this.d.log?.(`discord activity: ${state}`)
      }
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
        this.save()
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
      this.save()
      await this.send(this.inflight)
    } catch (err) {
      this.d.log?.(`discord activity flush failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      this.flushing = false
    }
  }

  /** True when the batch is settled (acknowledged, a duplicate, switched off, or rejected as invalid). */
  private async send(b: { body: ActivityBatchBody; tries: number }): Promise<boolean> {
    b.tries++
    const raw = await this.d.post(b.body)
    const { result: res, status } = typeof raw === 'string' ? ({ result: raw } as ActivityPostOutcome) : raw
    const what = res === 'ok' ? 'sent' : res === 'duplicate' ? 'already applied (duplicate)' : res === 'off' ? 'refused: counting is off in the app' : res === 'rejected' ? 'rejected by the app as invalid; dropped' : 'failed'
    this.d.log?.(`discord activity: batch ${b.body.batchId.slice(0, 8)} with ${b.body.users.length} user(s) ${what}${b.tries > 1 ? ` (try ${b.tries})` : ''}`)
    if (res === 'error') {
      // Never dropped: the same id and payload are resent on every flush until the app takes it.
      const t = this.now()
      if (b.tries >= WARN_AFTER_TRIES && t - this.lastWarnAt >= LOG_EVERY_MS) {
        this.lastWarnAt = t
        this.d.log?.(`discord activity: batch ${b.body.batchId} failing for ${b.tries} tries (${status ?? 'error'}); still retrying`)
      }
      this.save()
      return false
    }
    if (b.tries > 1 && res !== 'rejected') this.d.log?.(`discord activity: batch ${b.body.batchId} delivered after ${b.tries} tries; recovered`)
    this.lastWarnAt = -Infinity
    this.inflight = null
    this.save()
    if (res === 'off') this.pending.clear()
    return true
  }
}
