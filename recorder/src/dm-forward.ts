/**
 * Forward direct messages sent to the bot to the app, which decides whether they are replies to a
 * follow-up (plans/followup-replies-inbox.md). Off unless FOLLOWUP_DM_FORWARD=on. The handler never
 * throws, never blocks the caller (retries run in the background) and never logs message text.
 */
/** discord.js ChannelType.DM (a literal, so this file needs no Discord import). */
const CHANNEL_TYPE_DM = 1

/** The slice of a discord.js Message this needs (kept structural so tests need no Discord objects). */
export interface DmMessage {
  id: string
  content: string
  guildId: string | null
  author: { id: string; bot: boolean }
  channel: { type: number; send(text: string): Promise<unknown> }
  react(emoji: string): Promise<unknown>
}

export type InboundAnswer = { ok: true; claimed: boolean; ack?: string } | { ok: false; retryable: boolean }

export interface DmForwardDeps {
  post(body: { senderId: string; text: string; externalKey: string }): Promise<InboundAnswer>
  sleep(ms: number): Promise<void>
  log(line: string): void
}

/** Waits before each retry: 5 s, 30 s, 2 min. */
export const RETRY_DELAYS_MS = [5_000, 30_000, 120_000]
export const ACK_EMOJI = '✅'

/** POST to the app. Retryable: network errors, 5xx, 429, 408 and auth/route errors (a key or deploy problem that gets fixed). */
export async function postFollowupInbound(appBaseUrl: string, apiKey: string, body: { senderId: string; text: string; externalKey: string }): Promise<InboundAnswer> {
  try {
    const res = await fetch(`${appBaseUrl}/api/followups/inbound`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return { ok: false, retryable: res.status >= 500 || [408, 429, 401, 403, 404, 503].includes(res.status) }
    const j = (await res.json().catch(() => null)) as { claimed?: unknown; ack?: unknown } | null
    return { ok: true, claimed: j?.claimed === true, ...(typeof j?.ack === 'string' ? { ack: j.ack } : {}) }
  } catch {
    return { ok: false, retryable: true }
  }
}

/** True for a human's text message sent to the bot in a DM. */
export function isHumanDmText(m: DmMessage): boolean {
  return m.guildId === null && m.channel.type === CHANNEL_TYPE_DM && !m.author.bot && m.content.trim().length > 0
}

/** Handle one message. Resolves when done (including retries); never rejects. */
export async function handleDm(m: DmMessage, deps: DmForwardDeps, delays: readonly number[] = RETRY_DELAYS_MS): Promise<void> {
  try {
    if (!isHumanDmText(m)) return
    const body = { senderId: m.author.id, text: m.content.slice(0, 4000), externalKey: `discord:${m.id}` }
    let answer = await deps.post(body)
    for (let i = 0; !answer.ok && answer.retryable && i < delays.length; i++) {
      await deps.sleep(delays[i])
      answer = await deps.post(body)
    }
    if (!answer.ok) {
      deps.log(`dm-forward: gave up on message ${m.id}`)
      return
    }
    if (!answer.claimed || answer.ack === undefined) return
    if (answer.ack === '') await m.react(ACK_EMOJI)
    else await m.channel.send(answer.ack)
  } catch (err) {
    deps.log(`dm-forward failed: ${err instanceof Error ? err.message.slice(0, 160) : 'error'}`)
  }
}
