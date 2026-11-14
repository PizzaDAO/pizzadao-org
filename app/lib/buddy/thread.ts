/**
 * Discord side of the buddy intro: open a private thread in the buddy channel, add both people and
 * post the intro. Private threads need Create Private Threads (and Send Messages in Threads) for the
 * bot on that channel. Never throws: failures come back as a reason the admin page can show.
 */
const API = 'https://discord.com/api/v10'
const TIMEOUT_MS = 8000

export type ThreadResult = { ok: true; threadId: string } | { ok: false; reason: string; threadId?: string }

export interface ThreadInput {
  channelId: string
  name: string
  content: string
  /** The two people: added to the thread and the only ones pinged. */
  userIds: string[]
}

export async function createPrivateThread(input: ThreadInput, opts: { fetchImpl?: typeof fetch; botToken?: string } = {}): Promise<ThreadResult> {
  const token = opts.botToken ?? process.env.DISCORD_BOT_TOKEN
  if (!token) return { ok: false, reason: 'discord_not_configured' }
  const doFetch = opts.fetchImpl ?? fetch
  const call = (path: string, method: string, body?: unknown) =>
    doFetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  try {
    // 12 = private thread; invitable false so only moderators can add more people.
    const created = await call(`/channels/${input.channelId}/threads`, 'POST', {
      name: input.name,
      type: 12,
      auto_archive_duration: 10080,
      invitable: false,
    })
    if (!created.ok) return { ok: false, reason: created.status === 429 ? 'rate_limited' : `thread_create_http_${created.status}` }
    const threadId = String(((await created.json()) as { id?: string }).id ?? '')
    if (!/^\d{5,25}$/.test(threadId)) return { ok: false, reason: 'thread_create_bad_response' }
    for (const userId of input.userIds) {
      const added = await call(`/channels/${threadId}/thread-members/${userId}`, 'PUT')
      if (!added.ok) return { ok: false, reason: `add_member_http_${added.status}`, threadId }
    }
    const posted = await call(`/channels/${threadId}/messages`, 'POST', {
      content: input.content.slice(0, 2000),
      allowed_mentions: { users: input.userIds },
    })
    if (!posted.ok) return { ok: false, reason: `post_http_${posted.status}`, threadId }
    return { ok: true, threadId }
  } catch (e) {
    return { ok: false, reason: (e as Error)?.name === 'TimeoutError' ? 'timeout' : 'network_error' }
  }
}
