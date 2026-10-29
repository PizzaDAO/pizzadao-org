/**
 * Discord direct messages from Metalhead (REST only; the recorder holds the gateway). Opens the DM
 * channel, then posts with the shared rate-limit handling. A 403 means the member has DMs closed
 * (Discord error 50007) and is reported as a failed channel, not an exception to retry.
 */
import { DiscordPostError, DISCORD_MESSAGE_LIMIT, postDiscordMessage } from '@/app/lib/discord-rest'

export const isDmClosed = (e: unknown): boolean => e instanceof DiscordPostError && e.status === 403

export async function openDmChannel(userId: string, botToken: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl('https://discord.com/api/v10/users/@me/channels', {
    method: 'POST',
    headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient_id: userId }),
    cache: 'no-store',
  })
  if (!res.ok) throw new DiscordPostError(`Discord could not open a DM channel (${res.status})`, res.status)
  const json = (await res.json().catch(() => null)) as { id?: string } | null
  if (!json?.id) throw new DiscordPostError('Discord returned no DM channel', 502)
  return json.id
}

export async function sendDiscordDm(
  userId: string,
  content: string,
  opts: { components?: unknown[]; botToken?: string; fetchImpl?: typeof fetch } = {},
): Promise<{ channelId: string; messageId: string | null }> {
  const botToken = opts.botToken ?? process.env.DISCORD_BOT_TOKEN?.trim()
  if (!botToken) throw new DiscordPostError('Discord bot is not configured', 503)
  const channelId = await openDmChannel(userId, botToken, opts.fetchImpl)
  const posted = await postDiscordMessage(
    { kind: 'bot', channelId, botToken },
    { content: content.slice(0, DISCORD_MESSAGE_LIMIT), allowed_mentions: { parse: [] }, ...(opts.components ? { components: opts.components } : {}) },
    { fetchImpl: opts.fetchImpl },
  )
  return { channelId, messageId: posted.id }
}
