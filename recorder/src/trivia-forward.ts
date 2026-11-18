/**
 * Forward typed trivia answers to the app (plans/trivia.md section 7). The recorder is a thin forwarder: it only
 * drops what can never be an answer (other channels, bots and webhooks, empty or long messages); the app owns the
 * question bank, the matching, the caps and the payout.
 *
 * Off unless the app's remote config says so (trivia.enabled, trivia.channelIds: production with trivia on).
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
/** ok: delivered (or permanently pointless); retry: try again; drop: the app refused it for good. */
export type ForwardResult = 'ok' | 'retry' | 'drop'

export interface TriviaForwardDeps {
  config(): TriviaForwardConfig
  post(body: ForwardBody): Promise<ForwardResult>
  sleep(ms: number): Promise<void>
  log(line: string): void
  /** Only this guild's messages are forwarded. */
  guildId: string
}

/** POST one answer to the app. Network errors, 5xx, 429 and auth/route errors (a key or deploy problem that gets fixed) are retried. */
export async function postTriviaAnswer(appBaseUrl: string, apiKey: string, body: ForwardBody, fetchImpl: typeof fetch = fetch): Promise<ForwardResult> {
  try {
    const res = await fetchImpl(`${appBaseUrl}/api/trivia/discord/answer`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })
    if (res.ok) return 'ok'
    return res.status >= 500 || [408, 429, 401, 403, 404].includes(res.status) ? 'retry' : 'drop'
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

  constructor(
    private readonly deps: TriviaForwardDeps,
    private readonly delays: readonly number[] = FORWARD_RETRY_DELAYS_MS,
  ) {}

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
  }
}
