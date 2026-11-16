import { describe, expect, it, vi } from 'vitest'
import { ActivityCounter, postActivityBatch, toActivityEvent, type ActivityBatchBody, type ActivityEvent, type ActivityPostResult, type MessageLike } from './discord-activity.js'

const GUILD = '900000000000000001'
const T = Date.parse('2026-11-16T10:00:00Z')
const msg = (over: Partial<MessageLike> = {}): MessageLike => ({
  guildId: GUILD,
  author: { id: '100000000000000001', username: 'someone' },
  createdTimestamp: T,
  type: 0,
  channel: { name: 'general', isThread: () => false },
  ...over,
})
const ev = (over: Partial<ActivityEvent> = {}): ActivityEvent => ({ discordId: '100000000000000001', authorName: 'someone', atMs: T, channelName: 'general', reply: false, thread: false, ...over })

describe('toActivityEvent', () => {
  it('counts a person in the guild', () => {
    expect(toActivityEvent(msg(), GUILD)).toEqual(ev())
  })
  it('ignores other guilds, DMs, bots, webhooks and system messages', () => {
    expect(toActivityEvent(msg({ guildId: '1' }), GUILD)).toBeNull()
    expect(toActivityEvent(msg({ guildId: null }), GUILD)).toBeNull()
    expect(toActivityEvent(msg({ author: { id: '2', bot: true } }), GUILD)).toBeNull()
    expect(toActivityEvent(msg({ webhookId: '5' }), GUILD)).toBeNull()
    expect(toActivityEvent(msg({ system: true }), GUILD)).toBeNull()
    expect(toActivityEvent(msg({ type: 7 }), GUILD)).toBeNull()
  })
  it('a reply is a reply; a thread message counts toward its parent channel', () => {
    expect(toActivityEvent(msg({ type: 19 }), GUILD)!.reply).toBe(true)
    const t = toActivityEvent(msg({ channel: { name: 'a thread', parent: { name: 'general' }, isThread: () => true } }), GUILD)!
    expect(t).toMatchObject({ thread: true, channelName: 'general' })
  })
})

function counter(results: ActivityPostResult[] = ['ok'], cfg = { enabled: true, flushSeconds: 300 }) {
  const sent: ActivityBatchBody[] = []
  let n = 0
  let i = 0
  const log = vi.fn()
  const c = new ActivityCounter({
    post: async (b) => {
      sent.push(JSON.parse(JSON.stringify(b)))
      return results[Math.min(i++, results.length - 1)]
    },
    config: () => cfg,
    log,
    newId: () => `batch-${String(++n).padStart(8, '0')}`,
  })
  return { c, sent, log, cfg }
}

describe('ActivityCounter', () => {
  it('batches counts per member with days, channels, replies and threads', async () => {
    const { c, sent } = counter()
    c.add(ev())
    c.add(ev({ atMs: T + 1000, reply: true }))
    c.add(ev({ atMs: T + 86_400_000, channelName: 'pizza', thread: true }))
    c.add(ev({ discordId: '100000000000000002', authorName: null }))
    await c.flush()
    expect(sent).toHaveLength(1)
    const [a, b] = sent[0].users
    expect(a).toMatchObject({ discordId: '100000000000000001', days: { '2026-11-16': 2, '2026-11-17': 1 }, channels: { general: 2, pizza: 1 }, replies: 1, threads: 1, firstAt: new Date(T).toISOString() })
    expect(b.discordId).toBe('100000000000000002')
    expect(c.pendingUsers).toBe(0)
  })

  it('sends nothing when idle', async () => {
    const { c, sent } = counter()
    await c.flush()
    expect(sent).toHaveLength(0)
  })

  it('resends a failed batch with the SAME id and contents, then sends the counts that arrived meanwhile as a new batch', async () => {
    const { c, sent } = counter(['error', 'ok', 'ok'])
    c.add(ev())
    await c.flush() // fails
    c.add(ev({ atMs: T + 5000 })) // arrives meanwhile
    await c.flush() // resends the first batch, then the new count
    expect(sent).toHaveLength(3)
    expect(sent[1]).toEqual(sent[0])
    expect(sent[0].users[0].days).toEqual({ '2026-11-16': 1 })
    expect(sent[2].batchId).not.toBe(sent[0].batchId)
    expect(sent[2].users[0].days).toEqual({ '2026-11-16': 1 })
  })

  it('does not resend an acknowledged or duplicate batch', async () => {
    const { c, sent } = counter(['duplicate'])
    c.add(ev())
    await c.flush()
    await c.flush()
    expect(sent).toHaveLength(1)
  })

  it('counts nothing while switched off, and drops what it has when switched off (204)', async () => {
    const off = counter(['ok'], { enabled: false, flushSeconds: 300 })
    off.c.add(ev())
    expect(off.c.pendingUsers).toBe(0)
    const { c, sent } = counter(['off'])
    c.add(ev())
    await c.flush()
    expect(sent).toHaveLength(1)
    await c.flush()
    expect(sent).toHaveLength(1)
  })

  it('gives up on a batch after repeated failures', async () => {
    const { c, sent, log } = counter(['error'])
    c.add(ev())
    for (let i = 0; i < 14; i++) await c.flush()
    expect(sent.length).toBe(12)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('dropping a batch'))
  })

  it('logs once when live counting begins (the backfill --until)', () => {
    const { c, log } = counter()
    c.add(ev())
    c.add(ev())
    expect(log.mock.calls.filter((a) => String(a[0]).includes('live counting began'))).toHaveLength(1)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('2026-11-16T10:00:00.000Z'))
  })
})

describe('postActivityBatch', () => {
  const body: ActivityBatchBody = { batchId: 'batch-00000001', users: [] }
  const res = (status: number, json: unknown = {}) => ({ status, ok: status < 400, json: async () => json }) as unknown as Response
  it('maps the answers', async () => {
    const log = vi.fn()
    const f = (r: Response) => (async () => r) as unknown as typeof fetch
    expect(await postActivityBatch('http://app', 'k', body, log, f(res(200, { status: 'applied' })))).toBe('ok')
    expect(await postActivityBatch('http://app', 'k', body, log, f(res(200, { status: 'duplicate' })))).toBe('duplicate')
    expect(await postActivityBatch('http://app', 'k', body, log, f(res(204)))).toBe('off')
    expect(await postActivityBatch('http://app', 'k', body, log, f(res(500)))).toBe('error')
    expect(await postActivityBatch('http://app', 'k', body, log, (async () => { throw new Error('x') }) as unknown as typeof fetch)).toBe('error')
  })
  it('sends the bearer key to the discord-activity route', async () => {
    const f = vi.fn(async () => res(200, { status: 'applied' }))
    await postActivityBatch('http://app', 'k', body, vi.fn(), f as unknown as typeof fetch)
    expect(f).toHaveBeenCalledWith('http://app/api/calls/recorder/discord-activity', expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer k' }) }))
  })
})
