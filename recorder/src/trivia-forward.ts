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
/** A reply to a question post may be a longer "this question is bad" note: forwarded up to this length (the app decides). */
export const MAX_REPLY_CHARS = 300
/**
 * Words that make a reply to a question post a likely "this question is bad" report. A copy of REPORT_WORDS in the app
 * (app/lib/trivia/reports.ts): app/lib/trivia/report-words.parity.test.ts fails if the two drift apart.
 */
export const REPORT_WORDS = ['bad', 'wrong', 'broken', 'report', 'flag', 'incorrect', 'outdated'] as const
const REPORT_WORD_RE = new RegExp(`\\b(?:${REPORT_WORDS.join('|')})\\b`, 'i')
/** True when the text contains a report word (whole word, any case). */
export const hasReportWord = (text: string): boolean => REPORT_WORD_RE.test(text)
/** The flag reaction a member uses to report a question (the bot pre-adds the same one). */
export const FLAG_EMOJI = '\u{1F6A9}'
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
  /** Discord `message_reference`: set when the message is a reply. */
  reference?: { messageId?: string | null } | null
  author: { id: string; bot: boolean }
}

export interface TriviaForwardConfig {
  enabled: boolean
  channelIds: readonly string[]
}

export type ForwardBody = { channelId: string; messageId: string; authorId: string; content: string; /** The message this replies to, when it is a reply. */ replyTo?: string }
/** A reaction on the question post (kind "reaction"): `messageId` is the message that was reacted to. */
export type ReactionBody = { kind: 'reaction'; channelId: string; messageId: string; authorId: string; emoji: { id: string | null; name: string | null } }
export type AnyForwardBody = ForwardBody | ReactionBody

/** The slice of a discord.js reaction event this needs (structural). `emoji.id` is null for a unicode emoji. */
export interface TriviaReaction {
  messageId: string
  channelId: string
  guildId: string | null
  emoji: { id: string | null; name: string | null }
  user: { id: string; bot: boolean }
}

/** The state the app reports: is a round open, and which message is its question post. */
export interface TriviaRoundState {
  open: boolean
  messageId: string | null
  /** Question posts of the last 7 days: flags and report replies on them are forwarded even when no round is open. */
  recentMessageIds?: string[]
}
/** ok: delivered; retry: try again; drop: this message is refused for good (bad body); refused: the app rejected the key or route (401/403/404): drop it, never retry. */
export type ForwardResult = 'ok' | 'retry' | 'drop' | 'refused'

export interface TriviaForwardDeps {
  config(): TriviaForwardConfig
  post(body: AnyForwardBody): Promise<ForwardResult>
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

/** Like fetchTriviaState, with the question post's message id (reactions are forwarded for that message only). */
export async function fetchTriviaRound(appBaseUrl: string, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<TriviaRoundState | null> {
  try {
    const res = await fetchImpl(`${appBaseUrl}/api/trivia/discord/state`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(4_000),
    })
    if (!res.ok) return null
    const j = (await res.json().catch(() => null)) as { open?: unknown; messageId?: unknown; recentMessageIds?: unknown } | null
    const ids = Array.isArray(j?.recentMessageIds) ? (j!.recentMessageIds as unknown[]).filter((x): x is string => typeof x === 'string' && /^\d{5,25}$/.test(x)).slice(0, 100) : []
    return { open: j?.open === true, messageId: typeof j?.messageId === 'string' && /^\d{5,25}$/.test(j.messageId) ? j.messageId : null, recentMessageIds: ids }
  } catch {
    return null
  }
}

/** POST one answer to the app. Network errors, 5xx, 429 and 408 are retried; 401/403/404 (a key or deploy problem) are refused, not retried, so a bad key cannot cause a retry storm. */
export async function postTriviaAnswer(appBaseUrl: string, apiKey: string, body: AnyForwardBody, fetchImpl: typeof fetch = fetch): Promise<ForwardResult> {
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
export function isCandidate(m: TriviaMessage, cfg: TriviaForwardConfig, guildId: string, maxChars: number = MAX_FORWARD_CHARS): boolean {
  if (!cfg.enabled || cfg.channelIds.length === 0 || !cfg.channelIds.includes(m.channelId)) return false
  if (m.guildId !== guildId) return false
  if (m.author.bot || m.webhookId || m.system) return false
  const text = m.content.trim()
  return text.length > 0 && text.length <= maxChars
}

export class TriviaForwarder {
  private readonly chains = new Map<string, Promise<void>>()
  private readonly pending = new Map<string, number>()
  private warnedEmpty = false
  private open = false
  private recent: { at: number; body: AnyForwardBody }[] = []
  private questionMessageId: string | null = null
  private fetchState: (() => Promise<boolean | TriviaRoundState | null>) | null = null
  private pollInFlight = false
  private lastPollSoon = 0
  private recentPosts = new Set<string>()
  private lastRefusedLog = 0
  private refusedSince = 0

  constructor(
    private readonly deps: TriviaForwardDeps,
    private readonly delays: readonly number[] = FORWARD_RETRY_DELAYS_MS,
  ) {}

  /** A round opened or closed (from the state poll). On opening, the last few seconds of short messages are sent too. */
  setOpen(open: boolean, now: number = Date.now(), messageId: string | null = null): void {
    this.open = open
    // Always follow the app's latest question post: a new round can open between two polls while the last answer was
    // still open, and its picks must not be dropped as "another message".
    this.questionMessageId = open ? messageId : null
    const fresh = this.recent.filter((r) => now - r.at <= PRE_OPEN_BUFFER_MS)
    if (!open) {
      this.recent = fresh
      return
    }
    // Send what was waiting for a round (or for the new question post) that now matches; keep the rest until it ages out.
    this.recent = fresh.filter((r) => !this.wantsBody(r.body))
    for (const r of fresh) if (this.wantsBody(r.body)) this.enqueueBody(r.body)
  }

  /** Poll the app once and apply the answer. Never throws; a failed poll leaves the last state in force. */
  async refreshState(fetchState: () => Promise<boolean | TriviaRoundState | null>): Promise<void> {
    this.fetchState = fetchState
    try {
      if (!this.deps.config().enabled) {
        this.recentPosts = new Set()
        return this.setOpen(false)
      }
      const state = await fetchState()
      if (state === null) return
      if (typeof state === 'boolean') return this.setOpen(state)
      if (state.recentMessageIds) this.recentPosts = new Set(state.recentMessageIds)
      this.setOpen(state.open, Date.now(), state.messageId)
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
      const replyTo = m.reference?.messageId ?? undefined
      // A reply to a question post of the last 7 days may be a report ("this one is bad"): a little longer than an answer.
      // The app decides whether it is a report or a guess.
      // Outside an open round only a reply that contains a report word is forwarded straight away (ordinary replies
      // are ordinary chat there and follow the normal gating); during an open round every reply to a question post is
      // forwarded, as before (it may be a guess).
      const toQuestion = !!replyTo && this.recentPosts.has(replyTo) && (this.open || hasReportWord(m.content))
      if (!isCandidate(m, cfg, this.deps.guildId, toQuestion ? MAX_REPLY_CHARS : MAX_FORWARD_CHARS)) return
      const body: ForwardBody = { channelId: m.channelId, messageId: m.id, authorId: m.author.id, content: m.content.trim(), ...(replyTo ? { replyTo } : {}) }
      if (toQuestion) this.enqueueBody(body)
      else this.accept(body)
    } catch (err) {
      this.deps.log(`trivia-forward failed: ${err instanceof Error ? err.message.slice(0, 160) : 'error'}`)
    }
  }

  /**
   * A member's reaction on a message in the trivia channel. Forwarded only while a round is open and only when it is on
   * the question post (once the app has told us which message that is); bots, including our own pre-added reactions,
   * are dropped. Returns at once; never throws.
   */
  onReaction(r: TriviaReaction): void {
    try {
      const cfg = this.deps.config()
      if (!cfg.enabled || !cfg.channelIds.includes(r.channelId)) return
      if (r.guildId !== this.deps.guildId || r.user.bot) return
      if (!r.emoji.id && !r.emoji.name) return
      // A flag on a question post of the last 7 days is a report, not an answer: forwarded even when no round is open.
      if (!r.emoji.id && r.emoji.name?.replace(/\uFE0F/g, '') === FLAG_EMOJI) {
        if (this.recentPosts.has(r.messageId)) this.enqueueBody({ kind: 'reaction', channelId: r.channelId, messageId: r.messageId, authorId: r.user.id, emoji: { id: null, name: r.emoji.name } })
        return
      }
      this.accept({ kind: 'reaction', channelId: r.channelId, messageId: r.messageId, authorId: r.user.id, emoji: { id: r.emoji.id, name: r.emoji.name } })
    } catch (err) {
      this.deps.log(`trivia-forward failed: ${err instanceof Error ? err.message.slice(0, 160) : 'error'}`)
    }
  }

  /** Poll the app right away (at most one in flight, at most one per second) instead of waiting for the next tick. */
  private pollSoon(now: number = Date.now()): void {
    if (!this.fetchState || this.pollInFlight || now - this.lastPollSoon < 1000) return
    this.lastPollSoon = now
    this.pollInFlight = true
    void this.refreshState(this.fetchState).finally(() => {
      this.pollInFlight = false
    })
  }

  /** Forward now when a round is open, else keep it for a few seconds in case one opens. */
  private accept(body: AnyForwardBody): void {
    // A reaction on a message that is not the question post we know, while a round is open: the app may have opened a
    // new round since the last poll. Keep it, ask the app now, and it is sent (or aged out) when the answer arrives.
    if (this.open && 'kind' in body && this.questionMessageId && body.messageId !== this.questionMessageId) {
      const now = Date.now()
      this.recent = this.recent.filter((r) => now - r.at <= PRE_OPEN_BUFFER_MS).slice(-50)
      this.recent.push({ at: now, body })
      this.pollSoon(now)
      return
    }
    if (!this.open) {
      const now = Date.now()
      this.recent = this.recent.filter((r) => now - r.at <= PRE_OPEN_BUFFER_MS).slice(-50)
      this.recent.push({ at: now, body })
      return
    }
    if (this.wantsBody(body)) this.enqueueBody(body)
  }

  /** Reactions go only to the question post, when it is known. */
  private wantsBody(body: AnyForwardBody): boolean {
    return !('kind' in body) || !this.questionMessageId || body.messageId === this.questionMessageId
  }

  private enqueueBody(body: AnyForwardBody): void {
    try {
      const channel = body.channelId
      const queued = this.pending.get(channel) ?? 0
      if (queued >= MAX_QUEUED_PER_CHANNEL) {
        this.deps.log(`trivia-forward: queue full for channel ${channel}; dropped message ${body.messageId}`)
        return
      }
      this.pending.set(channel, queued + 1)
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

  private async deliver(body: AnyForwardBody): Promise<void> {
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
