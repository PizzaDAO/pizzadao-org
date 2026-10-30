// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/db')
vi.mock('@/app/lib/crew-mappings', () => ({ getCrewMappings: vi.fn(async () => ({ cached: true, crews: [] })) }))
vi.mock('@/app/lib/telegram/city-posts', () => ({ enqueueMirror: vi.fn(async () => ({ queued: 0, reason: 'error' })) }))
vi.mock('@/app/lib/discord-channels', () => ({ resolveChannelId: vi.fn(async () => null) }))

import { prisma } from '@/app/lib/db'
import { enqueueMirror } from '@/app/lib/telegram/city-posts'
import { DiscordPostError } from '@/app/lib/discord-rest'
import { clearPostFilterCache, type PostFilter } from './post-filters'
import { buildRecapText, channelIdFromCell, parseChannelCell, postCallRecap, recapBullets, recapFilteredCount, recapPostingEnabled, redactionsNewerThanSummary, resolveRecapChannel } from './recap'

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>
const base = 'https://example.org'
const rec = {
  id: 'abc123',
  title: 'Ops sync',
  crewLabel: 'Ops',
  summary: 'We reviewed the launch plan. The budget was approved. Ann will own the vendor list. Next call moves to Thursday.',
  actionItems: [{ text: 'Send the deck', owner: 'Ann' }, { text: 'Book the venue' }],
  chapters: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  clearPostFilterCache()
  db.appSetting.findMany.mockResolvedValue([])
})

describe('recap text', () => {
  it('has title, bullets, action items with owners and the link', () => {
    const t = buildRecapText(rec, base)
    expect(t).toContain('**Call recap: Ops sync**')
    expect(t).toContain('- We reviewed the launch plan.')
    expect(t).toContain('- Send the deck (Ann)')
    expect(t).toContain('- Book the venue')
    expect(t).toContain('https://example.org/calls/abc123')
  })
  it('stays under 2000 characters however long the content is', () => {
    const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} ${'x'.repeat(300)}.`).join(' ')
    const t = buildRecapText({ ...rec, summary: long, actionItems: Array.from({ length: 30 }, () => ({ text: 'y'.repeat(500), owner: 'z'.repeat(100) })) }, base)
    expect(t.length).toBeLessThanOrEqual(2000)
    expect(t).toContain('/calls/abc123')
  })
  it('falls back to chapter titles when the summary has too few sentences', () => {
    const b = recapBullets('One short thing.', [{ title: 'Budget' }, { title: 'Launch' }, { title: 'Venue' }])
    expect(b).toEqual(['Budget', 'Launch', 'Venue'])
  })
  it('flattens newlines so a title cannot inject lines', () => {
    expect(buildRecapText({ ...rec, title: 'A\n@everyone' }, base)).toContain('**Call recap: A @everyone**')
  })
})

describe('channel resolution', () => {
  const GUILD = '555555555555555555'
  const env = { DISCORD_GUILD_ID: GUILD }
  const crewsOf = (channel: string) => async () => [{ id: 'ops', channel }]

  it('parses ids, links and mentions', () => {
    expect(channelIdFromCell('123456789012345678')).toBe('123456789012345678')
    expect(parseChannelCell('https://discord.com/channels/111111111111111111/222222222222222222')).toEqual({ guildId: '111111111111111111', channelId: '222222222222222222' })
    expect(channelIdFromCell('<#333333333333333333>')).toBe('333333333333333333')
    expect(channelIdFromCell('ops')).toBeNull()
  })
  it('sends the Community Call to the announcements channel', async () => {
    expect((await resolveRecapChannel('community_call', { env: {} }))?.channelId).toBe('812143244149915679')
    expect((await resolveRecapChannel('community_call', { env: { ANNOUNCE_DISCORD_CHANNEL_ID: '999999999999999999' } }))?.channelId).toBe('999999999999999999')
  })
  it('rejects a link into another guild without even looking the channel up', async () => {
    const lookupChannel = vi.fn()
    expect(await resolveRecapChannel('ops', { env, crews: crewsOf('https://discord.com/channels/111111111111111111/222222222222222222'), lookupChannel })).toBeNull()
    expect(lookupChannel).not.toHaveBeenCalled()
  })
  it('verifies bare ids belong to our guild and are text/announcement channels', async () => {
    const id = '222222222222222222'
    expect(await resolveRecapChannel('ops', { env, crews: crewsOf(id), lookupChannel: async () => ({ guildId: GUILD, type: 0 }) })).toMatchObject({ channelId: id })
    expect(await resolveRecapChannel('ops', { env, crews: crewsOf(id), lookupChannel: async () => ({ guildId: '111111111111111111', type: 0 }) })).toBeNull()
    expect(await resolveRecapChannel('ops', { env, crews: crewsOf(id), lookupChannel: async () => ({ guildId: GUILD, type: 2 }) })).toBeNull() // voice
    expect(await resolveRecapChannel('ops', { env, crews: crewsOf(id), lookupChannel: async () => null })).toBeNull()
    expect(await resolveRecapChannel('ops', { env: {}, crews: crewsOf(id), lookupChannel: async () => ({ guildId: GUILD, type: 0 }) })).toBeNull() // no guild configured
  })
  it('resolves names exactly (no suffix guessing) and returns null when there is no channel', async () => {
    const resolveName = vi.fn(async (n: string) => (n === 'ops-chat' ? '444444444444444444' : null))
    expect(await resolveRecapChannel('ops', { env, crews: crewsOf('#ops-chat'), resolveName })).toMatchObject({ channelId: '444444444444444444' })
    expect(await resolveRecapChannel('ops', { env, crews: crewsOf('chat'), resolveName })).toBeNull()
    expect(await resolveRecapChannel('ops', { env, crews: crewsOf(''), resolveName })).toBeNull()
    expect(await resolveRecapChannel(null, { env })).toBeNull()
  })
})

describe('postCallRecap', () => {
  const env = { CALL_RECAP_POST_ENABLED: '1', DISCORD_BOT_TOKEN: 'tok' }
  const published = { ...rec, status: 'PUBLISHED', crewId: 'community_call', eventName: null, recapPostedAt: null, redactionsUpdatedAt: null, summaryGeneratedAt: null, summaryEditedAt: null }

  it('is off by default and touches nothing', async () => {
    expect(await recapPostingEnabled({})).toBe(false)
    expect(await postCallRecap('abc123', { env: {} })).toBe('disabled')
    expect(db.callRecording.findUnique).not.toHaveBeenCalled()
  })
  it('does not post a call that is not published', async () => {
    db.callRecording.findUnique.mockResolvedValue({ ...published, status: 'IN_REVIEW' })
    const post = vi.fn()
    expect(await postCallRecap('abc123', { env, post })).toBe('not-published')
    expect(post).not.toHaveBeenCalled()
  })
  it('posts once with no mentions, and records the message id', async () => {
    db.callRecording.findUnique.mockResolvedValue(published)
    db.callRecording.updateMany.mockResolvedValue({ count: 1 })
    db.callRecording.update.mockResolvedValue({})
    const post = vi.fn(async () => ({ id: 'm1' }))
    expect(await postCallRecap('abc123', { env, post, base })).toBe('posted')
    const [target, body] = post.mock.calls[0] as unknown as [{ kind: string; channelId: string }, { content: string; allowed_mentions: unknown }]
    expect(target).toMatchObject({ kind: 'bot', channelId: '812143244149915679' })
    expect(body.allowed_mentions).toEqual({ parse: [] })
    expect(body.content).toContain('https://example.org/calls/abc123')
    expect(db.callRecording.update).toHaveBeenCalledWith({ where: { id: 'abc123' }, data: { recapMessageId: 'm1' } })
  })
  it('mirrors the same text to Telegram after the claim, and a Telegram problem never changes the Discord result', async () => {
    db.callRecording.findUnique.mockResolvedValue(published)
    db.callRecording.updateMany.mockResolvedValue({ count: 1 })
    db.callRecording.update.mockResolvedValue({})
    const post = vi.fn(async () => ({ id: 'm1' }))
    expect(await postCallRecap('abc123', { env, post, base })).toBe('posted')
    expect(enqueueMirror).toHaveBeenCalledTimes(1)
    const arg = vi.mocked(enqueueMirror).mock.calls[0][0]
    expect(arg).toMatchObject({ kind: 'recap', sourceId: 'abc123', crewId: 'community_call' })
    expect(arg.text).toBe((post.mock.calls[0] as unknown as [unknown, { content: string }])[1].content)
  })
  it('mirrors on an unknown Discord outcome (claim kept) but never when Discord refused', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    db.callRecording.findUnique.mockResolvedValue(published)
    db.callRecording.updateMany.mockResolvedValue({ count: 1 })
    await postCallRecap('abc123', { env, post: vi.fn(async () => { throw new DiscordPostError('forbidden', 403) }) })
    expect(enqueueMirror).not.toHaveBeenCalled()
    await postCallRecap('abc123', { env, post: vi.fn(async () => { throw new DiscordPostError('bad gateway', 502) }) })
    expect(enqueueMirror).toHaveBeenCalledTimes(1)
  })
  it('does not mirror when the post is not allowed or the claim is lost', async () => {
    db.callRecording.findUnique.mockResolvedValue({ ...published, status: 'IN_REVIEW' })
    await postCallRecap('abc123', { env, post: vi.fn() })
    db.callRecording.findUnique.mockResolvedValue(published)
    db.callRecording.updateMany.mockResolvedValue({ count: 0 })
    await postCallRecap('abc123', { env, post: vi.fn() })
    expect(enqueueMirror).not.toHaveBeenCalled()
  })
  it('never double-posts', async () => {
    const post = vi.fn()
    db.callRecording.findUnique.mockResolvedValue({ ...published, recapPostedAt: new Date() })
    expect(await postCallRecap('abc123', { env, post })).toBe('already-posted')
    db.callRecording.findUnique.mockResolvedValue(published)
    db.callRecording.updateMany.mockResolvedValue({ count: 0 })
    expect(await postCallRecap('abc123', { env, post })).toBe('already-posted')
    expect(post).not.toHaveBeenCalled()
  })
  it('releases the claim only when Discord definitely refused (4xx incl. 429)', async () => {
    db.callRecording.findUnique.mockResolvedValue(published)
    db.callRecording.updateMany.mockResolvedValue({ count: 1 })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const status of [403, 429]) {
      db.callRecording.updateMany.mockClear()
      db.callRecording.updateMany.mockResolvedValue({ count: 1 })
      const post = vi.fn(async () => {
        throw new DiscordPostError('refused', status)
      })
      expect(await postCallRecap('abc123', { env, post })).toBe('failed')
      expect(db.callRecording.updateMany).toHaveBeenLastCalledWith({ where: { id: 'abc123' }, data: expect.objectContaining({ recapPostedAt: null, recapChannelId: null }) })
    }
  })
  it('keeps the claim and records the error on a 5xx or a network failure (the message may exist)', async () => {
    db.callRecording.findUnique.mockResolvedValue(published)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const err of [new DiscordPostError('boom', 502), new Error('socket hang up')]) {
      db.callRecording.updateMany.mockClear()
      db.callRecording.updateMany.mockResolvedValue({ count: 1 })
      expect(await postCallRecap('abc123', { env, post: async () => Promise.reject(err) })).toBe('failed')
      const last = db.callRecording.updateMany.mock.calls.at(-1)![0]
      expect(last.data.recapPostedAt).toBeUndefined() // not released
      expect(last.data.recapError).toMatch(/^unknown outcome/)
    }
  })
  it('a failure storing the message id after a successful post does not release the claim or fail', async () => {
    db.callRecording.findUnique.mockResolvedValue(published)
    db.callRecording.updateMany.mockClear()
    db.callRecording.updateMany.mockResolvedValue({ count: 1 })
    db.callRecording.update.mockRejectedValue(new Error('db down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await postCallRecap('abc123', { env, post: async () => ({ id: 'm9' }) })).toBe('posted')
    expect(db.callRecording.updateMany).toHaveBeenCalledTimes(1) // only the claim
  })
  it('blocks posting when a redaction is newer than the summary', async () => {
    const post = vi.fn()
    db.callRecording.findUnique.mockResolvedValue({ ...published, summaryGeneratedAt: new Date('2026-10-28T10:00:00Z'), redactionsUpdatedAt: new Date('2026-10-28T11:00:00Z') })
    expect(await postCallRecap('abc123', { env, post })).toBe('stale-redactions')
    expect(post).not.toHaveBeenCalled()
    // Regenerating or editing after the redaction clears the block.
    expect(redactionsNewerThanSummary({ summaryGeneratedAt: new Date('2026-10-28T12:00:00Z'), redactionsUpdatedAt: new Date('2026-10-28T11:00:00Z') })).toBe(false)
    expect(redactionsNewerThanSummary({ summaryGeneratedAt: new Date('2026-10-28T10:00:00Z'), summaryEditedAt: new Date('2026-10-28T12:00:00Z'), redactionsUpdatedAt: new Date('2026-10-28T11:00:00Z') })).toBe(false)
    expect(redactionsNewerThanSummary({ redactionsUpdatedAt: null })).toBe(false)
  })
  it('reports a missing token or channel', async () => {
    expect(await postCallRecap('abc123', { env: { CALL_RECAP_POST_ENABLED: '1' } })).toBe('no-token')
    db.callRecording.findUnique.mockResolvedValue({ ...published, crewId: null })
    expect(await postCallRecap('abc123', { env, post: vi.fn() })).toBe('no-channel')
  })
})

describe('post filters', () => {
  const filter: PostFilter = { excludedCrewIds: ['crew_x'], excludedCrewLabelTerms: ['ZETA'], blockedTerms: ['ZETA'] }
  const marked = {
    ...rec,
    summary: 'We reviewed the launch plan. The ZETA group wants a separate budget. Ann will own the vendor list. Next call moves to Thursday.',
    actionItems: [{ text: 'Send the deck', owner: 'Ann' }, { text: 'Ping the zeta leads' }, { text: 'Hand off', owner: 'Team Zeta' }],
  }
  it('drops blocked bullets and action items from the Discord text only', () => {
    const t = buildRecapText(marked, base, filter)
    expect(t.toLowerCase()).not.toContain('zeta')
    expect(t).toContain('- We reviewed the launch plan.')
    expect(t).toContain('- Send the deck (Ann)')
    expect(marked.summary).toContain('ZETA') // stored summary untouched
    expect(recapFilteredCount(marked, filter)).toBe(3)
    expect(recapFilteredCount(rec, filter)).toBe(0)
  })
  it('matches whole words only', () => {
    expect(buildRecapText({ ...rec, summary: 'Zetamax shipped. Alpha done. Beta done. Gamma done.' }, base, filter)).toContain('Zetamax shipped.')
  })
  it('drops blocked chapter titles in the chapter fallback', () => {
    expect(recapBullets('Short.', [{ title: 'Budget' }, { title: 'ZETA plans' }, { title: 'Launch' }, { title: 'Venue' }], filter)).toEqual(['Budget', 'Launch', 'Venue'])
  })
  const published = { ...rec, status: 'PUBLISHED', crewId: 'community_call', eventName: null, recapPostedAt: null, redactionsUpdatedAt: null, summaryGeneratedAt: null, summaryEditedAt: null }
  const env = { CALL_RECAP_POST_ENABLED: '1', DISCORD_BOT_TOKEN: 'tok' }
  it('never posts a recap for an excluded crew, by id or label word', async () => {
    db.appSetting.findMany.mockResolvedValue([{ key: 'calls.postFilter', value: filter }])
    const post = vi.fn()
    db.callRecording.findUnique.mockResolvedValue({ ...published, crewId: 'crew_x', crewLabel: 'Whatever' })
    expect(await postCallRecap('abc123', { env, post })).toBe('excluded')
    clearPostFilterCache()
    db.callRecording.findUnique.mockResolvedValue({ ...published, crewId: 'xyz', crewLabel: 'Team Zeta' })
    expect(await postCallRecap('abc123', { env, post })).toBe('excluded')
    expect(post).not.toHaveBeenCalled()
    expect(db.callRecording.updateMany).not.toHaveBeenCalled()
  })
  it('posts nothing (and claims nothing) when the filter cannot be read', async () => {
    db.appSetting.findMany.mockRejectedValue(new Error('db down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    db.callRecording.findUnique.mockResolvedValue(published)
    const post = vi.fn()
    expect(await postCallRecap('abc123', { env, post })).toBe('failed')
    expect(post).not.toHaveBeenCalled()
    expect(db.callRecording.updateMany).not.toHaveBeenCalled()
  })
})
