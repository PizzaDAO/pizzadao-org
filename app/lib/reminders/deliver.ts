/**
 * One Discord DM, and what its outcome means. Previews never send: the sender is allowed only on the
 * production deploy with the bot configured (like telegramSendAllowed).
 *
 *   403  DMs closed (Discord error 50007)  -> 'closed'  (mark the member, back off; never retried now)
 *   429  rate limited past the short wait  -> 'rate_limited'  (stop the run, leave the rest for the next)
 *   5xx or network (uncertain)             -> 'retry'   (release the claim; a few attempts)
 *   other 4xx (unknown user, bad request)  -> 'failed'  (permanent)
 */
import { DiscordPostError } from '@/app/lib/discord-rest'
import { isDmClosed, sendDiscordDm } from '@/app/lib/followups/discord-dm'
import { sendDm, type DmFailureCode, type DmResult, type TelegramButton } from '@/app/lib/telegram/rsv-client'
import { createHash } from 'node:crypto'

type Env = Record<string, string | undefined>

export type DmSender = (userId: string, content: string, opts: { components?: unknown[] }) => Promise<unknown>

export type DmOutcome =
  | { kind: 'sent' }
  | { kind: 'closed' }
  | { kind: 'rate_limited' }
  | { kind: 'retry'; code: string }
  | { kind: 'failed'; code: string }

/** Production only, with the bot configured. */
export function reminderSendAllowed(env: Env = process.env): boolean {
  return env.VERCEL_ENV === 'production' && !!env.DISCORD_BOT_TOKEN?.trim()
}

export function classifyDmError(e: unknown): DmOutcome {
  if (isDmClosed(e)) return { kind: 'closed' }
  if (e instanceof DiscordPostError) {
    if (e.status === 429) return { kind: 'rate_limited' }
    if (e.status >= 500 || e.status === 408) return { kind: 'retry', code: `http_${e.status}` }
    return { kind: 'failed', code: `http_${e.status}` }
  }
  return { kind: 'retry', code: 'uncertain' }
}

export async function deliverDm(o: { discordId: string; text: string; components?: unknown[]; send?: DmSender }): Promise<DmOutcome> {
  const send = o.send ?? ((id, text, opts) => sendDiscordDm(id, text, opts))
  try {
    await send(o.discordId, o.text, { components: o.components })
    return { kind: 'sent' }
  } catch (e) {
    return classifyDmError(e)
  }
}

export type TelegramSender = (a: { telegramUserId: string; text: string; buttons?: TelegramButton[][]; idempotencyKey: string }) => Promise<DmResult>

export type TelegramOutcome =
  | { kind: 'sent'; replay: boolean }
  | { kind: 'unreachable'; code: 'not_started' | 'blocked'; replay: boolean }
  | { kind: 'retry'; code: string }
  | { kind: 'failed'; code: string }

/** The Telegram idempotency key of one call reminder: hashed, so no member id appears in the proxy's logs. */
export const telegramKeyFor = (refKey: string, discordId: string): string =>
  `rm:${createHash('sha256').update(`reminder:call:${refKey}:${discordId}`).digest('hex').slice(0, 40)}`

/**
 * One Telegram DM and what its outcome means. The proxy remembers the idempotency key and replays its answer
 * (including `uncertain`) for it, so an uncertain answer is final for Telegram: retrying the same key would only
 * repeat it. Only answers that definitely sent nothing are retried.
 *
 *   not_started / blocked          -> 'unreachable' (record the reach; not retried now)
 *   rate_limited / unavailable     -> 'retry' (nothing was sent; the same key is still free)
 *   uncertain / bad_request / not_configured -> 'failed'
 */
export async function deliverTelegram(o: { telegramUserId: string; text: string; buttons?: TelegramButton[][]; idempotencyKey: string; send?: TelegramSender }): Promise<TelegramOutcome> {
  const send = o.send ?? sendDm
  let r: DmResult
  try {
    r = await send({ telegramUserId: o.telegramUserId, text: o.text, buttons: o.buttons, idempotencyKey: o.idempotencyKey })
  } catch {
    return { kind: 'failed', code: 'uncertain' }
  }
  if (r.ok) return { kind: 'sent', replay: !!r.replay }
  const code: DmFailureCode = r.code
  switch (code) {
    case 'not_started':
    case 'blocked':
      return { kind: 'unreachable', code, replay: !!r.replay }
    case 'rate_limited':
    case 'unavailable':
      return { kind: 'retry', code }
    default:
      return { kind: 'failed', code }
  }
}
