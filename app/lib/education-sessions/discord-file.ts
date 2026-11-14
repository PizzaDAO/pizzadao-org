/**
 * Post a bot message with one attached file (multipart: payload_json + files[0]). The shared
 * postDiscordMessage helper is JSON-only; this is the same request with an attachment. A 429 is not
 * retried here (a lead can press Schedule again; the claim logic makes that safe). Server-side only.
 */
import { DiscordPostError, type DiscordMessageBody } from '@/app/lib/discord-rest'

export async function postMessageWithFile(
  target: { channelId: string; botToken: string },
  body: Omit<DiscordMessageBody, 'embeds' | 'components'>,
  file: { name: string; type: string; data: Buffer },
  fetchImpl: typeof fetch = fetch,
): Promise<{ id: string | null }> {
  if (!/^\d{5,25}$/.test(target.channelId)) throw new DiscordPostError('Bad channel id', 400)
  const form = new FormData()
  form.set('payload_json', JSON.stringify({ ...body, attachments: [{ id: 0, filename: file.name }] }))
  form.set('files[0]', new Blob([new Uint8Array(file.data)], { type: file.type }), file.name)
  const res = await fetchImpl(`https://discord.com/api/v10/channels/${target.channelId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${target.botToken}` },
    body: form,
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  })
  const text = await res.text()
  if (!res.ok) {
    let detail = text.slice(0, 300)
    try {
      const j = JSON.parse(text) as { message?: string; code?: number }
      if (j.message) detail = `${j.message}${j.code ? ` (code ${j.code})` : ''}`
    } catch {
      /* keep raw text */
    }
    throw new DiscordPostError(`Discord API error ${res.status} posting to channel ${target.channelId}: ${detail}`, res.status)
  }
  try {
    return { id: (JSON.parse(text) as { id?: string }).id ?? null }
  } catch {
    return { id: null }
  }
}

/**
 * Edit a bot message in place and REPLACE its attachment with a new file (multipart PATCH: the
 * `attachments` list names only the new file, so the old flyer is dropped, not appended).
 */
export async function editMessageWithFile(
  target: { channelId: string; messageId: string; botToken: string },
  body: Omit<DiscordMessageBody, 'embeds' | 'components'>,
  file: { name: string; type: string; data: Buffer },
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (!/^\d{5,25}$/.test(target.channelId) || !/^\d{5,25}$/.test(target.messageId)) throw new DiscordPostError('Bad channel or message id', 400)
  const form = new FormData()
  form.set('payload_json', JSON.stringify({ ...body, attachments: [{ id: 0, filename: file.name }] }))
  form.set('files[0]', new Blob([new Uint8Array(file.data)], { type: file.type }), file.name)
  const res = await fetchImpl(`https://discord.com/api/v10/channels/${target.channelId}/messages/${target.messageId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bot ${target.botToken}` },
    body: form,
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new DiscordPostError(`Discord API error ${res.status} editing message ${target.messageId}: ${text.slice(0, 300)}`, res.status)
  }
}
