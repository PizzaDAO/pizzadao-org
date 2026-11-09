// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/app/lib/db')

import {
  parseJobRequirements,
  verifyJobPost,
  verifyPostsEnabled,
  unverifiablePayOnClick,
  __resetJobsVerifyCache,
  MAX_PAGES,
  type DiscordMessage,
} from './jobs-verify'
import { clearSettingsCache } from './settings'
import { prisma } from '@/app/lib/db'

const CH = '111111111111111111'
const FORUM = '777777777777777777'
const ME = '222222222222222222'
const USER = '333333333333333333'
const ROLE = '444444444444444444'
const TH = '555555555555555555'
const SINCE = new Date('2026-01-10T00:00:00Z')

const msg = (o: Partial<DiscordMessage> & { id: string }): DiscordMessage => ({
  timestamp: '2026-01-10T12:00:00Z',
  author: { id: ME },
  content: '',
  mentions: [],
  mention_roles: [],
  attachments: [],
  embeds: [],
  ...o,
})

interface Fake {
  channels?: Record<string, DiscordMessage[]>
  types?: Record<string, number>
  threads?: { id: string; parent_id: string; last_message_id?: string }[]
  archived?: { id: string; parent_id: string; last_message_id?: string }[]
  /** Status for every call, or a map of path substring -> status. */
  fail?: number | Record<string, number>
  rateLimitFirst?: boolean
}

/** Fake Discord. Messages for after=<id> are the ones past that id (or from the start), newest first like Discord. */
function fakeFetch(f: Fake) {
  let limited = false
  const fn = vi.fn(async (url: string) => {
    if (typeof f.fail === 'number') return new Response('no', { status: f.fail })
    for (const [part, status] of Object.entries(f.fail ?? {})) if (url.includes(part)) return new Response('no', { status })
    if (f.rateLimitFirst && !limited) {
      limited = true
      return Response.json({ retry_after: 0.5 }, { status: 429 })
    }
    if (url.includes('/threads/active')) return Response.json({ threads: f.threads ?? [] })
    if (url.includes('/threads/archived/public')) return Response.json({ threads: f.archived ?? [] })
    const mm = url.match(/channels\/(\d+)\/messages\?limit=(\d+)&after=(\d+)/)
    if (mm) {
      const all = [...(f.channels?.[mm[1]] ?? [])].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))
      const idx = all.findIndex((x) => x.id === mm[3])
      return Response.json(all.slice(idx + 1, idx + 1 + Number(mm[2])).reverse())
    }
    const cm = url.match(/channels\/(\d+)$/)
    if (cm) return Response.json({ id: cm[1], type: f.types?.[cm[1]] ?? 0 })
    return new Response('?', { status: 500 })
  })
  return fn as unknown as typeof fetch & typeof fn
}

const noSleep = vi.fn(async () => {})
const run = (description: string, f: Fake, extra: { used?: string[]; fetchImpl?: typeof fetch } = {}) =>
  verifyJobPost({
    memberId: ME,
    description,
    since: SINCE,
    usedMessageIds: extra.used,
    fetchImpl: extra.fetchImpl ?? fakeFetch(f),
    sleep: noSleep,
  })

beforeEach(() => {
  __resetJobsVerifyCache()
  noSleep.mockClear()
  vi.stubEnv('DISCORD_BOT_TOKEN', 'tok')
  vi.stubEnv('DISCORD_GUILD_ID', '999999999999999999')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('parseJobRequirements', () => {
  it('reads channels, tagged users, roles and media wording from the markup', () => {
    expect(parseJobRequirements(`Tag <@${USER}> with a bonk gif in <#${CH}> and tag <@&${ROLE}>`)).toEqual({
      channelIds: [CH], userIds: [USER], roleIds: [ROLE], needsMedia: true,
    })
  })
  it('only requires users the job asks to tag, not every user named', () => {
    const r = parseJobRequirements(`<@${USER}> is hosting. Share a movie in <#${CH}>`)
    expect(r.userIds).toEqual([])
    expect(parseJobRequirements(`Mention <@${USER}>, <@${ME}> in <#${CH}>`).userIds).toEqual([USER, ME])
  })
  it('generic image/picture/result wording does not require media; explicit words do', () => {
    expect(parseJobRequirements(`Share your results in <#${CH}>`).needsMedia).toBe(false)
    expect(parseJobRequirements(`Describe a picture in <#${CH}>`).needsMedia).toBe(false)
    for (const w of ['meme', 'selfie', 'clip', 'sticker', 'drawing', 'art', 'pfp', 'screenshot', 'photo', 'pic', 'video', 'gif']) {
      expect(parseJobRequirements(`Post a ${w} in <#${CH}>`).needsMedia).toBe(true)
    }
  })
  it('plain jobs need nothing', () => {
    expect(parseJobRequirements('Say hi')).toEqual({ channelIds: [], userIds: [], roleIds: [], needsMedia: false })
  })
})

describe('verifyJobPost', () => {
  const desc = `Share a movie in <#${CH}>`

  it('found: the member posted in the channel today', async () => {
    expect(await run(desc, { channels: { [CH]: [msg({ id: '5' })] } })).toEqual({ ok: true, verified: true, messageId: '5', channelId: CH })
  })
  it('not found: empty channel', async () => {
    expect(await run(desc, { channels: { [CH]: [] } })).toMatchObject({ ok: false, reason: 'not_found', channelId: CH })
  })
  it('wrong author', async () => {
    expect(await run(desc, { channels: { [CH]: [msg({ id: '5', author: { id: 'x' } })] } })).toMatchObject({ reason: 'not_found' })
  })
  it('old message (before today)', async () => {
    expect(await run(desc, { channels: { [CH]: [msg({ id: '5', timestamp: '2026-01-09T23:59:00Z' })] } })).toMatchObject({ reason: 'not_found' })
  })
  it('pages oldest to newest with after= and finds a late post in a busy channel', async () => {
    const others = Array.from({ length: 250 }, (_, i) => msg({ id: String(1000 + i), author: { id: 'x' } }))
    const f = fakeFetch({ channels: { [CH]: [...others, msg({ id: '5000' })] } })
    expect(await run(desc, {}, { fetchImpl: f })).toMatchObject({ ok: true, messageId: '5000' })
    const urls = f.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('/messages'))
    expect(urls.length).toBe(3)
    expect(urls.every((u) => u.includes('&after='))).toBe(true)
  })
  it('caps the pages read', async () => {
    const others = Array.from({ length: (MAX_PAGES + 2) * 100 }, (_, i) => msg({ id: String(1000 + i), author: { id: 'x' } }))
    const f = fakeFetch({ channels: { [CH]: others } })
    expect(await run(desc, {}, { fetchImpl: f })).toMatchObject({ reason: 'not_found' })
    expect(f.mock.calls.filter((c) => String(c[0]).includes('/messages')).length).toBe(MAX_PAGES)
  })
  it('shares one short cache of today\'s messages between members', async () => {
    const f = fakeFetch({ channels: { [CH]: [msg({ id: '5' })] } })
    await run(desc, {}, { fetchImpl: f })
    await run(desc, {}, { fetchImpl: f })
    expect(f.mock.calls.filter((c) => String(c[0]).includes('/messages')).length).toBe(1)
  })

  it('user mention: needed only when tagged; the mentions array or the raw content both count', async () => {
    const d = `Tag <@${USER}> in <#${CH}>`
    expect(await run(d, { channels: { [CH]: [msg({ id: '5' })] } })).toMatchObject({ reason: 'not_found' })
    __resetJobsVerifyCache()
    expect(await run(d, { channels: { [CH]: [msg({ id: '5', mentions: [{ id: USER }] })] } })).toMatchObject({ ok: true })
    __resetJobsVerifyCache()
    expect(await run(d, { channels: { [CH]: [msg({ id: '5', content: `hi <@${USER}>` })] } })).toMatchObject({ ok: true })
    __resetJobsVerifyCache()
    // Named but not tagged: no mention needed.
    expect(await run(`<@${USER}> hosts. Share in <#${CH}>`, { channels: { [CH]: [msg({ id: '5' })] } })).toMatchObject({ ok: true })
  })
  it('role mention: mention_roles or raw <@&id> in the content', async () => {
    const d = `Tag <@&${ROLE}> in <#${CH}>`
    expect(await run(d, { channels: { [CH]: [msg({ id: '5' })] } })).toMatchObject({ reason: 'not_found' })
    __resetJobsVerifyCache()
    expect(await run(d, { channels: { [CH]: [msg({ id: '5', mention_roles: [ROLE] })] } })).toMatchObject({ ok: true })
    __resetJobsVerifyCache()
    expect(await run(d, { channels: { [CH]: [msg({ id: '5', content: `<@&${ROLE}> hi` })] } })).toMatchObject({ ok: true })
  })

  describe('media', () => {
    const d = `Post a gif in <#${CH}>`
    const check = async (m: Partial<DiscordMessage>) => {
      __resetJobsVerifyCache()
      return run(d, { channels: { [CH]: [msg({ id: '5', ...m })] } })
    }
    it('missing gif', async () => {
      expect(await check({})).toMatchObject({ reason: 'not_found' })
    })
    it('attachments, gif embeds, stickers and media-host embeds count', async () => {
      expect(await check({ embeds: [{ type: 'gifv' }] })).toMatchObject({ ok: true })
      expect(await check({ attachments: [{ content_type: 'image/png' }] })).toMatchObject({ ok: true })
      expect(await check({ sticker_items: [{ id: '1' }] })).toMatchObject({ ok: true })
      expect(await check({ embeds: [{ type: 'rich', url: 'https://tenor.com/view/x' }] })).toMatchObject({ ok: true })
      expect(await check({ embeds: [{ type: 'link', url: 'https://www.youtube.com/watch?v=1' }] })).toMatchObject({ ok: true })
      expect(await check({ embeds: [{ type: 'link', provider: { name: 'Imgur' } }] })).toMatchObject({ ok: true })
    })
    it('a plain link embed on another host does not count', async () => {
      expect(await check({ embeds: [{ type: 'link', url: 'https://example.com/a' }] })).toMatchObject({ reason: 'not_found' })
    })
    it('re-fetches once when the message has no embeds yet, and sees them arrive', async () => {
      let calls = 0
      const base = fakeFetch({ channels: { [CH]: [msg({ id: '5' })] } })
      const late = vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).includes('/messages')) {
          calls++
          if (calls >= 2) {
            const r = await base(url, init)
            const list = (await r.json()) as DiscordMessage[]
            return Response.json(list.map((m) => ({ ...m, embeds: [{ type: 'gifv' }] })))
          }
        }
        return base(url, init)
      }) as unknown as typeof fetch
      expect(await run(d, {}, { fetchImpl: late })).toMatchObject({ ok: true, messageId: '5' })
      expect(noSleep).toHaveBeenCalledTimes(1)
    })
    it('re-fetches only once', async () => {
      const f = fakeFetch({ channels: { [CH]: [msg({ id: '5' })] } })
      expect(await run(d, {}, { fetchImpl: f })).toMatchObject({ reason: 'not_found' })
      expect(f.mock.calls.filter((c) => String(c[0]).includes('/messages')).length).toBe(2)
    })
  })

  it('one message pays one job: a post that already paid is rejected as reused', async () => {
    expect(await run(desc, { channels: { [CH]: [msg({ id: '5' })] } }, { used: ['5'] })).toMatchObject({ ok: false, reason: 'reused' })
    __resetJobsVerifyCache()
    // A second, unused post still pays.
    expect(await run(desc, { channels: { [CH]: [msg({ id: '5' }), msg({ id: '6' })] } }, { used: ['5'] })).toMatchObject({ ok: true, messageId: '6' })
  })

  describe('threads and forums', () => {
    it('searches active threads of a text channel, newest activity first, at most 10', async () => {
      const base = (BigInt(SINCE.getTime()) - BigInt('1420070400000')) * BigInt(4194304)
      const threads = Array.from({ length: 12 }, (_, i) => ({ id: String(800000000000000000 + i * 1000), parent_id: CH, last_message_id: String(base + BigInt(1000 + i)) }))
      const f = fakeFetch({ channels: { [CH]: [] }, threads: [...threads, { id: '666666666666666666', parent_id: 'other', last_message_id: '9999' }] })
      await run(desc, {}, { fetchImpl: f })
      const asked = f.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('/messages')).map((u) => u.match(/channels\/(\d+)/)![1])
      expect(asked.length).toBe(11) // the channel + 10 threads
      expect(asked[1]).toBe(threads[11].id) // newest first
      expect(asked).not.toContain('666666666666666666')
    })
    it('finds a post in a thread of the channel', async () => {
      const r = await run(desc, { channels: { [CH]: [], [TH]: [msg({ id: '7' })] }, threads: [{ id: TH, parent_id: CH }] })
      expect(r).toMatchObject({ ok: true, messageId: '7', channelId: TH })
    })
    it('forum channel: detects the type and searches active and archived threads, not /messages of the forum', async () => {
      const f = fakeFetch({
        types: { [FORUM]: 15 },
        channels: { [TH]: [], '888888888888888888': [msg({ id: '9' })] },
        threads: [{ id: TH, parent_id: FORUM }],
        archived: [{ id: '888888888888888888', parent_id: FORUM }],
      })
      const r = await run(`Post in <#${FORUM}>`, {}, { fetchImpl: f })
      expect(r).toMatchObject({ ok: true, messageId: '9', channelId: '888888888888888888' })
      expect(f.mock.calls.map((c) => String(c[0])).some((u) => u.includes(`channels/${FORUM}/messages`))).toBe(false)
    })
  })

  describe('Discord problems', () => {
    it('403/404 on the channel: channel_unavailable, logged, and cached so Discord is not hit again', async () => {
      const f = fakeFetch({ fail: { [`channels/${CH}`]: 404 } })
      expect(await run(desc, {}, { fetchImpl: f })).toMatchObject({ ok: false, reason: 'channel_unavailable' })
      const calls = f.mock.calls.length
      expect(await run(desc, {}, { fetchImpl: f })).toMatchObject({ ok: false, reason: 'channel_unavailable' })
      expect(f.mock.calls.length).toBe(calls)
      expect(console.warn).toHaveBeenCalled()
    })
    it('403 on the messages is also channel_unavailable', async () => {
      expect(await run(desc, { fail: { '/messages': 403 } })).toMatchObject({ reason: 'channel_unavailable' })
    })
    it('5xx: unreachable, never found', async () => {
      expect(await run(desc, { fail: 500 })).toEqual({ ok: false, reason: 'unreachable' })
    })
    it('network error: unreachable', async () => {
      const throwing = (async () => { throw new Error('offline') }) as unknown as typeof fetch
      expect(await run(desc, {}, { fetchImpl: throwing })).toEqual({ ok: false, reason: 'unreachable' })
    })
    it('429 with a short retry_after: waits and retries once', async () => {
      const f = fakeFetch({ channels: { [CH]: [msg({ id: '5' })] }, rateLimitFirst: true })
      expect(await run(desc, {}, { fetchImpl: f })).toMatchObject({ ok: true })
      expect(noSleep).toHaveBeenCalledWith(500)
    })
    it('429 again: unreachable (503)', async () => {
      const f = vi.fn(async () => Response.json({ retry_after: 0.1 }, { status: 429 })) as unknown as typeof fetch
      expect(await run(desc, {}, { fetchImpl: f })).toEqual({ ok: false, reason: 'unreachable' })
    })
    it('no bot token: unreachable (fail closed)', async () => {
      vi.stubEnv('DISCORD_BOT_TOKEN', '')
      expect(await run(desc, { channels: { [CH]: [msg({ id: '5' })] } })).toEqual({ ok: false, reason: 'unreachable' })
    })
  })

  it('no channel in the job: nothing to verify', async () => {
    expect(await run('Say hi', {})).toEqual({ ok: true, verified: false })
  })
})

describe('switches', () => {
  beforeEach(() => {
    clearSettingsCache({ all: true })
    vi.mocked(prisma.appSetting.findMany).mockReset()
    vi.mocked(prisma.appSetting.findMany).mockResolvedValue([])
  })
  it('verification defaults ON; the env kill switch turns it off', async () => {
    expect(await verifyPostsEnabled({})).toBe(true)
    expect(await verifyPostsEnabled({ JOBS_VERIFY_POSTS: 'off' })).toBe(false)
  })
  it('an unreadable setting keeps verification ON', async () => {
    vi.mocked(prisma.appSetting.findMany).mockRejectedValue(new Error('db down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await verifyPostsEnabled({ VERCEL_ENV: 'production' })).toBe(true)
  })
  it('unverifiable jobs pay on click by default; env off stops it', async () => {
    expect(await unverifiablePayOnClick({})).toBe(true)
    expect(await unverifiablePayOnClick({ JOBS_UNVERIFIABLE_PAY_ON_CLICK: '0' })).toBe(false)
  })
})
