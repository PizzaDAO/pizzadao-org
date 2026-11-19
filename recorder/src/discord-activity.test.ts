import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

  it('never drops a batch on 5xx/network/timeout: 500 x20 then 200 sends it once with the same id', async () => {
    const { c, sent, log } = counter([...Array(20).fill('error'), 'ok'])
    c.add(ev())
    for (let i = 0; i < 25; i++) await c.flush()
    expect(sent).toHaveLength(21)
    expect(new Set(sent.map((b) => b.batchId)).size).toBe(1)
    for (const b of sent) expect(b).toEqual(sent[0])
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining('dropping'))
    expect(log).toHaveBeenCalledWith('discord activity: batch batch-00000001 delivered after 21 tries; recovered')
  })

  it('drops a batch the app rejects as invalid (400/422)', async () => {
    const { c, sent } = counter(['rejected'])
    c.add(ev())
    await c.flush()
    await c.flush()
    expect(sent).toHaveLength(1)
    c.add(ev())
    await c.flush()
    expect(sent).toHaveLength(2)
    expect(sent[1].batchId).not.toBe(sent[0].batchId)
  })

  it('logs an error once after 3 failed tries, then at most hourly, with the status', async () => {
    let now = 1_000_000
    const log = vi.fn()
    const c = new ActivityCounter({ post: async () => ({ result: 'error', status: '500' }), config: () => ({ enabled: true, flushSeconds: 300 }), log, newId: () => 'batch-0000000a', now: () => now })
    c.add(ev())
    const warns = () => log.mock.calls.filter((a) => String(a[0]).includes('failing for')).length
    await c.flush()
    await c.flush()
    expect(warns()).toBe(0)
    await c.flush()
    expect(warns()).toBe(1)
    expect(log).toHaveBeenCalledWith('discord activity: batch batch-0000000a failing for 3 tries (500); still retrying')
    for (let i = 0; i < 10; i++) {
      now += 300_000 // 50 minutes in total
      await c.flush()
    }
    expect(warns()).toBe(1)
    now += 600_000 // past the hour
    await c.flush()
    expect(warns()).toBe(2)
  })

  it('keeps accumulating pending counts while a batch is stuck, then sends them as a NEW batch after recovery', async () => {
    const { c, sent } = counter(['error', 'error', 'error', 'ok', 'ok'])
    c.add(ev())
    await c.flush()
    c.add(ev({ discordId: '100000000000000002' }))
    await c.flush()
    c.add(ev({ discordId: '100000000000000003' }))
    expect(c.pendingUsers).toBe(2)
    expect(sent.every((b) => b.batchId === 'batch-00000001' && b.users.length === 1)).toBe(true)
    await c.flush() // third failure
    await c.flush() // recovers, then sends the two waiting users as batch 2
    expect(sent.at(-1)!.batchId).toBe('batch-00000002')
    expect(sent.at(-1)!.users).toHaveLength(2)
    expect(c.pendingUsers).toBe(0)
  })

  it('at the pending cap, discards counts for new people (loudly, at most hourly) but keeps counting people already pending', async () => {
    let now = 5_000_000
    const log = vi.fn()
    const c = new ActivityCounter({ post: async () => 'error', config: () => ({ enabled: true, flushSeconds: 300 }), log, now: () => now })
    for (let i = 0; i < 20_000; i++) c.add(ev({ discordId: String(i) }))
    expect(c.pendingUsers).toBe(20_000)
    c.add(ev({ discordId: 'new-1' }))
    c.add(ev({ discordId: 'new-2' }))
    expect(c.pendingUsers).toBe(20_000)
    const errs = () => log.mock.calls.filter((a) => String(a[0]).includes('pending is full')).length
    expect(errs()).toBe(1)
    now += 3_600_000
    c.add(ev({ discordId: 'new-3' }))
    expect(errs()).toBe(2)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('discarded counts for 3 new user message(s)'))
  })

  it('persists the in-flight batch so a restart resends it with the same id', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'activity-'))
    const stateFile = join(dir, 'inflight.json')
    try {
      const mk = (post: (b: ActivityBatchBody) => Promise<ActivityPostResult>, newId: () => string) => new ActivityCounter({ post, config: () => ({ enabled: true, flushSeconds: 300 }), newId, stateFile })
      const a = mk(async () => 'error', () => 'batch-persist')
      a.add(ev())
      await a.flush()
      expect(existsSync(stateFile)).toBe(true)
      const sent: ActivityBatchBody[] = []
      const b = mk(async (x) => { sent.push(x); return 'ok' }, () => 'other')
      await b.flush()
      expect(sent).toHaveLength(1)
      expect(sent[0].batchId).toBe('batch-persist')
      expect(sent[0].users[0].discordId).toBe('100000000000000001')
      expect(existsSync(stateFile)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
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
    expect(await postActivityBatch('http://app', 'k', body, log, f(res(400)))).toBe('rejected')
    expect(await postActivityBatch('http://app', 'k', body, log, f(res(422)))).toBe('rejected')
    // misconfiguration (401/403/404) is retried with a loud log, never dropped
    for (const st of [401, 403, 404]) expect(await postActivityBatch('http://app', 'k', body, log, f(res(st)))).toBe('error')
    expect(log).toHaveBeenCalledWith(expect.stringContaining('misconfiguration'))
    expect(await postActivityBatch('http://app', 'k', body, log, (async () => { throw new Error('x') }) as unknown as typeof fetch)).toBe('error')
  })
  it('sends the bearer key to the discord-activity route', async () => {
    const f = vi.fn(async () => res(200, { status: 'applied' }))
    await postActivityBatch('http://app', 'k', body, vi.fn(), f as unknown as typeof fetch)
    expect(f).toHaveBeenCalledWith('http://app/api/calls/recorder/discord-activity', expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer k' }) }))
  })

  it('logs whether counting is on and the flush interval at start, and again when the settings change it', async () => {
    vi.useFakeTimers()
    try {
      const { c, log, cfg } = counter(['ok'], { enabled: true, flushSeconds: 120 })
      c.start()
      expect(log).toHaveBeenCalledWith('discord activity: counting on, flushing every 120s')
      await vi.advanceTimersByTimeAsync(120_000)
      expect(log.mock.calls.filter((a) => String(a[0]).includes('flushing every'))).toHaveLength(1)
      cfg.enabled = false
      await vi.advanceTimersByTimeAsync(120_000)
      expect(log).toHaveBeenCalledWith('discord activity: counting off, flushing every 120s')
      c.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('logs one line per batch sent, with its result', async () => {
    const { c, log } = counter(['error', 'ok'])
    c.add(ev())
    c.add(ev({ discordId: '100000000000000002' }))
    await c.flush()
    expect(log).toHaveBeenCalledWith('discord activity: batch batch-00 with 2 user(s) failed')
    await c.flush()
    expect(log).toHaveBeenCalledWith('discord activity: batch batch-00 with 2 user(s) sent (try 2)')
    const d = counter(['duplicate'])
    d.c.add(ev())
    await d.c.flush()
    expect(d.log).toHaveBeenCalledWith('discord activity: batch batch-00 with 1 user(s) already applied (duplicate)')
  })
})
