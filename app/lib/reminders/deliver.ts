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
