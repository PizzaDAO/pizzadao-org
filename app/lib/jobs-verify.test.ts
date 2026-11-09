// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/app/lib/db')

import { parseJobRequirements, verifyJobPost, verifyPostsEnabled, unverifiablePayOnClick, type DiscordMessage } from './jobs-verify'
import { clearSettingsCache } from './settings'
import { prisma } from '@/app/lib/db'

const CH = '111111111111111111'
const ME = '222222222222222222'
const USER = '333333333333333333'
const ROLE = '444444444444444444'
const SINCE = new Date('2026-01-10T00:00:00Z')

const msg = (o: Partial<DiscordMessage> & { id: string }): DiscordMessage => ({
  timestamp: '2026-01-10T12:00:00Z',
  author: { id: ME },
  mentions: [],
  mention_roles: [],
  attachments: [],
  embeds: [],
  ...o,
})

/** Fake Discord: channel id -> messages newest first; honours limit and before. */
function fakeFetch(channels: Record<string, DiscordMessage[]>, opts: { fail?: number; threads?: unknown[] } = {}) {
  return vi.fn(async (url: string) => {
    if (opts.fail) return new Response('no', { status: opts.fail })
    if (url.includes('/threads/active')) return Response.json({ threads: opts.threads ?? [] })
    const m = url.match(/channels\/(\d+)\/messages\?limit=(\d+)(?:&before=(\d+))?/)!
    const all = channels[m[1]] ?? []
    const start = m[3] ? all.findIndex((x) => x.id === m[3]) + 1 : 0
    return Response.json(all.slice(start, start + Number(m[2])))
  }) as unknown as typeof fetch
}

const run = (description: string, channels: Record<string, DiscordMessage[]>, extra: Parameters<typeof fakeFetch>[1] = {}) =>
  verifyJobPost({ memberId: ME, description, since: SINCE, fetchImpl: fakeFetch(channels, extra) })

beforeEach(() => {
  vi.stubEnv('DISCORD_BOT_TOKEN', 'tok')
  vi.stubEnv('DISCORD_GUILD_ID', '999999999999999999')
})
afterEach(() => vi.unstubAllEnvs())

describe('parseJobRequirements', () => {
  it('reads channels, users, roles and media wording from the markup', () => {
    expect(parseJobRequirements(`Tag <@${USER}> with a bonk gif in <#${CH}> and tag <@&${ROLE}>`)).toEqual({
      channelIds: [CH], userIds: [USER], roleIds: [ROLE], needsMedia: true,
    })
  })
  it('plain jobs need nothing', () => {
    expect(parseJobRequirements('Say hi')).toEqual({ channelIds: [], userIds: [], roleIds: [], needsMedia: false })
  })
})

describe('verifyJobPost', () => {
  const desc = `Share a movie in <#${CH}>`

  it('found: the member posted in the channel today', async () => {
    const r = await run(desc, { [CH]: [msg({ id: '5' })] })
    expect(r).toEqual({ ok: true, verified: true, messageId: '5', channelId: CH })
  })
  it('not found: empty channel', async () => {
    const r = await run(desc, { [CH]: [] })
    expect(r).toMatchObject({ ok: false, reason: 'not_found', channelId: CH })
  })
  it('wrong author', async () => {
    const r = await run(desc, { [CH]: [msg({ id: '5', author: { id: 'someone-else' } })] })
    expect(r).toMatchObject({ ok: false, reason: 'not_found' })
  })
  it('old message (before today)', async () => {
    const r = await run(desc, { [CH]: [msg({ id: '5', timestamp: '2026-01-09T23:59:00Z' })] })
    expect(r).toMatchObject({ ok: false, reason: 'not_found' })
  })
  it('pages back past other people to find the post, within the cap', async () => {
    const others = Array.from({ length: 150 }, (_, i) => msg({ id: String(900 - i), author: { id: 'x' } }))
    const r = await run(desc, { [CH]: [...others, msg({ id: '5' })] })
    expect(r).toMatchObject({ ok: true, messageId: '5' })
  })
  it('stops at the cap', async () => {
    const others = Array.from({ length: 350 }, (_, i) => msg({ id: String(9000 - i), author: { id: 'x' } }))
    const f = fakeFetch({ [CH]: [...others, msg({ id: '5' })] })
    const r = await verifyJobPost({ memberId: ME, description: desc, since: SINCE, fetchImpl: f })
    expect(r).toMatchObject({ ok: false, reason: 'not_found' })
  })
  it('missing user mention', async () => {
    const d = `Tag <@${USER}> in <#${CH}>`
    expect(await run(d, { [CH]: [msg({ id: '5' })] })).toMatchObject({ ok: false, reason: 'not_found' })
    expect(await run(d, { [CH]: [msg({ id: '5', mentions: [{ id: USER }] })] })).toMatchObject({ ok: true })
  })
  it('missing role mention', async () => {
    const d = `Tag <@&${ROLE}> in <#${CH}>`
    expect(await run(d, { [CH]: [msg({ id: '5' })] })).toMatchObject({ ok: false, reason: 'not_found' })
    expect(await run(d, { [CH]: [msg({ id: '5', mention_roles: [ROLE] })] })).toMatchObject({ ok: true })
  })
  it('missing gif / image', async () => {
    const d = `Post a gif in <#${CH}>`
    expect(await run(d, { [CH]: [msg({ id: '5' })] })).toMatchObject({ ok: false, reason: 'not_found' })
    expect(await run(d, { [CH]: [msg({ id: '5', embeds: [{ type: 'gifv' }] })] })).toMatchObject({ ok: true })
    expect(await run(d, { [CH]: [msg({ id: '5', attachments: [{ content_type: 'image/png' }] })] })).toMatchObject({ ok: true })
    expect(await run(d, { [CH]: [msg({ id: '5', embeds: [{ type: 'link' }] })] })).toMatchObject({ ok: false })
  })
  it('finds a post in an active thread of the channel', async () => {
    const r = await run(desc, { [CH]: [], '555555555555555555': [msg({ id: '7' })] }, { threads: [{ id: '555555555555555555', parent_id: CH }, { id: '666666666666666666', parent_id: 'other' }] })
    expect(r).toMatchObject({ ok: true, messageId: '7', channelId: '555555555555555555' })
  })
  it('Discord down: unreachable, never found', async () => {
    expect(await run(desc, {}, { fail: 500 })).toEqual({ ok: false, reason: 'unreachable' })
    const throwing = (async () => { throw new Error('offline') }) as unknown as typeof fetch
    expect(await verifyJobPost({ memberId: ME, description: desc, since: SINCE, fetchImpl: throwing })).toEqual({ ok: false, reason: 'unreachable' })
  })
  it('no bot token: unreachable (fail closed)', async () => {
    vi.stubEnv('DISCORD_BOT_TOKEN', '')
    expect(await run(desc, { [CH]: [msg({ id: '5' })] })).toEqual({ ok: false, reason: 'unreachable' })
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
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await verifyPostsEnabled({ VERCEL_ENV: 'production' })).toBe(true)
  })
  it('unverifiable jobs pay on click by default; env off stops it', async () => {
    expect(await unverifiablePayOnClick({})).toBe(true)
    expect(await unverifiablePayOnClick({ JOBS_UNVERIFIABLE_PAY_ON_CLICK: '0' })).toBe(false)
  })
})
