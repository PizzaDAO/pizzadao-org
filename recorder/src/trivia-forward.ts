/**
 * Forward typed trivia answers to the app (plans/trivia.md section 7). The recorder is a thin forwarder: it only
 * drops what can never be an answer (other channels, bots and webhooks, empty or long messages); the app owns the
 * question bank, the matching, the caps and the payout.
 *
 * Off unless the app's remote config says so (trivia.enabled, trivia.channelIds: production with trivia on).
 * Even then a message is forwarded only while a round is open: the forwarder polls GET /api/trivia/discord/state
 * every few seconds (fetchTriviaState, RECORDER_API_KEY) and ordinary chat in the shared channel never leaves the
 * recorder the rest of the time. Short messages seen while closed are kept for a few seconds and sent when the state
 * flips to open (the app ignores any that predate the question), so a fast first answer is not lost to the poll gap.
 * Ordering matters ("first correct answer wins"): each channel has its own serial queue that awaits every POST
 * before sending the next, and a failed POST is retried in place, so the app sees answers in Discord order. The
 * queue is separate from the recording chain (index.ts `serial`), so trivia can never delay a recording. The handler
 * never throws, never blocks the caller and never logs message text.
 */

/** Longer than this is chat, not an answer (the app ignores it too; sending it would only cost a request). */
export const MAX_FORWARD_CHARS = 80
/** Messages waiting per channel; beyond this (the app is down and the channel is busy) new ones are dropped. */
export const MAX_QUEUED_PER_CHANNEL = 200
/** Waits before each retry of one message: 1 s, 3 s, 10 s, 30 s (about 45 s in all, then it is given up). */
export const FORWARD_RETRY_DELAYS_MS = [1_000, 3_000, 10_000, 30_000]

/** The slice of a discord.js Message this needs (structural, so tests need no Discord objects). */
export interface TriviaMessage {
  id: string
  content: string
  channelId: string
  guildId: string | null
  webhookId?: string | null
  system?: boolean
  author: { id: string; bot: boolean }
}

export interface TriviaForwardConfig {
  enabled: boolean
  channelIds: readonly string[]
}

export type ForwardBody = { channelId: string; messageId: string; authorId: string; content: string }
/** ok: delivered; retry: try again; drop: this message is refused for good (bad body); refused: the app rejected the key or route (401/403/404): drop it, never retry. */
export type ForwardResult = 'ok' | 'retry' | 'drop' | 'refused'

export interface TriviaForwardDeps {
  config(): TriviaForwardConfig
  post(body: ForwardBody): Promise<ForwardResult>
  sleep(ms: number): Promise<void>
  log(line: string): void
  /** Only this guild's messages are forwarded. */
  guildId: string
}

/** Messages seen while no round is open are kept this long and sent if one opens. */
export const PRE_OPEN_BUFFER_MS = 10_000
/** The refusal warning (a wrong key or a missing route) is logged at most this often, after the first time. */
export const REFUSED_LOG_EVERY_MS = 5 * 60_000

/** Is a round open? null when the app could not be asked (the last answer then stays in force). */
export async function fetchTriviaState(appBaseUrl: string, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<boolean | null> {
  try {
    const res = await fetchImpl(`${appBaseUrl}/api/trivia/discord/state`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(4_000),
    })
    if (!res.ok) return null
    const j = (await res.json().catch(() => null)) as { open?: unknown } | null
    return j?.open === true
  } catch {
    return null
  }
}

/** POST one answer to the app. Network errors, 5xx, 429 and 408 are retried; 401/403/404 (a key or deploy problem) are refused, not retried, so a bad key cannot cause a retry storm. */
export async function postTriviaAnswer(appBaseUrl: string, apiKey: string, body: ForwardBody, fetchImpl: typeof fetch = fetch): Promise<ForwardResult> {
  try {
    const res = await fetchImpl(`${appBaseUrl}/api/trivia/discord/answer`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })
    if (res.ok) return 'ok'
    if ([401, 403, 404].includes(res.status)) return 'refused'
    return res.status >= 500 || [408, 429].includes(res.status) ? 'retry' : 'drop'
  } catch {
    return 'retry'
  }
}

/** True for a message that could be an answer: a human's short text in a watched channel of our server. */
export function isCandidate(m: TriviaMessage, cfg: TriviaForwardConfig, guildId: string): boolean {
  if (!cfg.enabled || cfg.channelIds.length === 0 || !cfg.channelIds.includes(m.channelId)) return false
  if (m.guildId !== guildId) return false
  if (m.author.bot || m.webhookId || m.system) return false
  const text = m.content.trim()
  return text.length > 0 && text.length <= MAX_FORWARD_CHARS
}

export class TriviaForwarder {
  private readonly chains = new Map<string, Promise<void>>()
  private readonly pending = new Map<string, number>()
  private warnedEmpty = false
  private open = false
  private recent: { at: number; m: TriviaMessage }[] = []
  private lastRefusedLog = 0
  private refusedSince = 0

  constructor(
    private readonly deps: TriviaForwardDeps,
    private readonly delays: readonly number[] = FORWARD_RETRY_DELAYS_MS,
  ) {}

  /** A round opened or closed (from the state poll). On opening, the last few seconds of short messages are sent too. */
  setOpen(open: boolean, now: number = Date.now()): void {
    const was = this.open
    this.open = open
    if (open && !was) {
      const keep = this.recent.filter((r) => now - r.at <= PRE_OPEN_BUFFER_MS)
      this.recent = []
      for (const r of keep) this.enqueue(r.m)
    } else if (!open) {
      this.recent = this.recent.filter((r) => now - r.at <= PRE_OPEN_BUFFER_MS)
    }
  }

  /** Poll the app once and apply the answer. Never throws; a failed poll leaves the last state in force. */
  async refreshState(fetchState: () => Promise<boolean | null>): Promise<void> {
    try {
      if (!this.deps.config().enabled) return this.setOpen(false)
      const open = await fetchState()
      if (open !== null) this.setOpen(open)
    } catch (err) {
      this.deps.log(`trivia-forward state poll failed: ${err instanceof Error ? err.message.slice(0, 160) : 'error'}`)
    }
  }

  /** Queue a message. Returns at once; never throws. */
  onMessage(m: TriviaMessage): void {
    try {
      const cfg = this.deps.config()
      if (!cfg.enabled || !cfg.channelIds.includes(m.channelId)) return
      if (m.content === '' && !m.author.bot && !this.warnedEmpty) {
        // A human's message with no text usually means the MessageContent intent is missing (or CAPTURE_VOICE_CHAT is off).
        this.warnedEmpty = true
        this.deps.log('trivia-forward: a message in the trivia channel arrived with empty content (is MessageContent enabled?)')
      }
      if (!isCandidate(m, cfg, this.deps.guildId)) return
      if (!this.open) {
        const now = Date.now()
        this.recent = this.recent.filter((r) => now - r.at <= PRE_OPEN_BUFFER_MS).slice(-50)
        this.recent.push({ at: now, m })
        return
      }
      this.enqueue(m)
    } catch (err) {
      this.deps.log(`trivia-forward failed: ${err instanceof Error ? err.message.slice(0, 160) : 'error'}`)
    }
  }

  private enqueue(m: TriviaMessage): void {
    try {
      const channel = m.channelId
      const queued = this.pending.get(channel) ?? 0
      if (queued >= MAX_QUEUED_PER_CHANNEL) {
        this.deps.log(`trivia-forward: queue full for channel ${channel}; dropped message ${m.id}`)
        return
      }
      this.pending.set(channel, queued + 1)
      const body: ForwardBody = { channelId: channel, messageId: m.id, authorId: m.author.id, content: m.content.trim() }
      const prev = this.chains.get(channel) ?? Promise.resolve()
      const next = prev
        .then(() => this.deliver(body))
        .catch((err) => this.deps.log(`trivia-forward failed: ${err instanceof Error ? err.message.slice(0, 160) : 'error'}`))
        .finally(() => this.pending.set(channel, Math.max(0, (this.pending.get(channel) ?? 1) - 1)))
      this.chains.set(channel, next)
    } catch (err) {
      this.deps.log(`trivia-forward failed: ${err instanceof Error ? err.message.slice(0, 160) : 'error'}`)
    }
  }

  /** Resolves when everything queued so far has been delivered or given up (tests). */
  async idle(): Promise<void> {
    await Promise.all([...this.chains.values()])
  }

  private async deliver(body: ForwardBody): Promise<void> {
    let result = await this.deps.post(body)
    for (let i = 0; result === 'retry' && i < this.delays.length; i++) {
      await this.deps.sleep(this.delays[i])
      result = await this.deps.post(body)
    }
    if (result === 'retry') this.deps.log(`trivia-forward: gave up on message ${body.messageId}`)
    if (result === 'refused') this.warnRefused()
  }

  /** The app said 401/403/404: drop the message (no retry), log the first time, then at most every REFUSED_LOG_EVERY_MS with a count. */
  private warnRefused(now: number = Date.now()): void {
    this.refusedSince++
    if (this.lastRefusedLog !== 0 && now - this.lastRefusedLog < REFUSED_LOG_EVERY_MS) return
    this.lastRefusedLog = now
    this.deps.log(`trivia-forward: the app refused ${this.refusedSince} message(s) (401/403/404): check RECORDER_API_KEY and that the app has the trivia routes; messages are dropped, not retried`)
    this.refusedSince = 0
  }
}
