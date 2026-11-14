/**
 * Discord side of the buddy intro: open a private thread in the buddy channel, add both people and
 * post the intro. Private threads need Create Private Threads (and Send Messages in Threads) for the
 * bot on that channel. Never throws: failures come back as a reason the admin page can show.
 */
const API = 'https://discord.com/api/v10'
const TIMEOUT_MS = 8000

export type ThreadResult =
  | { ok: true; threadId: string }
  /** uncertain: the final post may or may not have gone out (timeout, network error, 5xx): never repost blindly. */
  | { ok: false; reason: string; threadId?: string; uncertain?: boolean }

export interface ThreadInput {
  channelId: string
  name: string
  content: string
  /** The two people: added to the thread and the only ones pinged. */
  userIds: string[]
  /** Retry of a half-made intro: reuse this thread (add the members, post) instead of creating a new one. */
  existingThreadId?: string
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
  const bareId = (v: string) => (/^\d{5,25}$/.test(v) ? v : undefined)
  let threadId = input.existingThreadId ?? ''
  let posting = false
  try {
    if (!/^\d{5,25}$/.test(threadId)) {
      // 12 = private thread; invitable false so only moderators can add more people.
      const created = await call(`/channels/${input.channelId}/threads`, 'POST', {
        name: input.name,
        type: 12,
        auto_archive_duration: 10080,
        invitable: false,
      })
      if (!created.ok) return { ok: false, reason: created.status === 429 ? 'rate_limited' : `thread_create_http_${created.status}` }
      threadId = String(((await created.json()) as { id?: string }).id ?? '')
      if (!/^\d{5,25}$/.test(threadId)) return { ok: false, reason: 'thread_create_bad_response' }
    }
    for (const userId of input.userIds) {
      const added = await call(`/channels/${threadId}/thread-members/${userId}`, 'PUT')
      if (!added.ok) return { ok: false, reason: `add_member_http_${added.status}`, threadId }
    }
    const content = input.content.slice(0, 2000)
    if (input.existingThreadId) {
      // A reused thread may already hold the intro (an earlier post whose answer was lost): look before posting.
      const found = await introAlreadyPosted(call, threadId, content)
      if (found === 'unknown') return { ok: false, reason: 'verify_failed', threadId, uncertain: true }
      if (found) return { ok: true, threadId }
    }
    posting = true
    const posted = await call(`/channels/${threadId}/messages`, 'POST', { content, allowed_mentions: { users: input.userIds } })
    if (!posted.ok) return { ok: false, reason: `post_http_${posted.status}`, threadId, ...(posted.status >= 500 ? { uncertain: true } : {}) }
    return { ok: true, threadId }
  } catch (e) {
    const reason = (e as Error)?.name === 'TimeoutError' ? 'timeout' : 'network_error'
    const id = bareId(threadId)
    return { ok: false, reason, ...(id ? { threadId: id } : {}), ...(posting ? { uncertain: true } : {}) }
  }
}

let botIdCache: string | null = null

/** Is the bot's intro already in the thread? Reads the latest messages and the bot's own id. 'unknown' when Discord cannot say. */
async function introAlreadyPosted(call: (path: string, method: string, body?: unknown) => Promise<Response>, threadId: string, content: string): Promise<boolean | 'unknown'> {
  try {
    if (!botIdCache) {
      const me = await call('/users/@me', 'GET')
      if (!me.ok) return 'unknown'
      botIdCache = String(((await me.json()) as { id?: string }).id ?? '') || null
      if (!botIdCache) return 'unknown'
    }
    const list = await call(`/channels/${threadId}/messages?limit=50`, 'GET')
    if (!list.ok) return 'unknown'
    const msgs = (await list.json()) as Array<{ author?: { id?: string }; content?: string }>
    return msgs.some((m) => m.author?.id === botIdCache && (m.content ?? '').slice(0, 80) === content.slice(0, 80))
  } catch {
    return 'unknown'
  }
}

export function clearBotIdCache() {
  botIdCache = null
}
