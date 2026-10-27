// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/db')
vi.mock('@/app/lib/crew-mappings', () => ({ getCrewMappings: vi.fn(async () => ({ cached: true, crews: [] })) }))
vi.mock('@/app/lib/discord-channels', () => ({ resolveChannelId: vi.fn(async () => null) }))

import { prisma } from '@/app/lib/db'
import { buildRecapText, channelIdFromCell, postCallRecap, recapBullets, recapPostingEnabled, resolveRecapChannel } from './recap'

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

beforeEach(() => vi.clearAllMocks())

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
  it('parses ids, links and mentions', () => {
    expect(channelIdFromCell('123456789012345678')).toBe('123456789012345678')
    expect(channelIdFromCell('https://discord.com/channels/111111111111111111/222222222222222222')).toBe('222222222222222222')
    expect(channelIdFromCell('<#333333333333333333>')).toBe('333333333333333333')
    expect(channelIdFromCell('ops')).toBeNull()
  })
  it('sends the Community Call to the announcements channel', async () => {
    expect((await resolveRecapChannel('community_call', { env: {} }))?.channelId).toBe('812143244149915679')
    expect((await resolveRecapChannel('community_call', { env: { ANNOUNCE_DISCORD_CHANNEL_ID: '999999999999999999' } }))?.channelId).toBe('999999999999999999')
  })
  it('uses the crew channel cell, by name when needed, else null', async () => {
    const crews = async () => [{ id: 'ops', channel: '#ops-chat' }, { id: 'art', channel: '' }]
    expect(await resolveRecapChannel('ops', { crews, resolveName: async (n) => (n === 'ops-chat' ? '444444444444444444' : null), env: {} })).toMatchObject({ channelId: '444444444444444444' })
    expect(await resolveRecapChannel('art', { crews, env: {} })).toBeNull()
    expect(await resolveRecapChannel(null, { env: {} })).toBeNull()
  })
})

describe('postCallRecap', () => {
  const env = { CALL_RECAP_POST_ENABLED: '1', DISCORD_BOT_TOKEN: 'tok' }
  const published = { ...rec, status: 'PUBLISHED', crewId: 'community_call', eventName: null, recapPostedAt: null }

  it('is off by default and touches nothing', async () => {
    expect(recapPostingEnabled({})).toBe(false)
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
    const post = vi.fn(async () => ({ id: 'm1' }))
    expect(await postCallRecap('abc123', { env, post, base })).toBe('posted')
    const [target, body] = post.mock.calls[0] as unknown as [{ kind: string; channelId: string }, { content: string; allowed_mentions: unknown }]
    expect(target).toMatchObject({ kind: 'bot', channelId: '812143244149915679' })
    expect(body.allowed_mentions).toEqual({ parse: [] })
    expect(body.content).toContain('https://example.org/calls/abc123')
    expect(db.callRecording.update).toHaveBeenCalledWith({ where: { id: 'abc123' }, data: { recapMessageId: 'm1' } })
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
  it('releases the claim when Discord fails so a later publish can retry', async () => {
    db.callRecording.findUnique.mockResolvedValue(published)
    db.callRecording.updateMany.mockResolvedValue({ count: 1 })
    const post = vi.fn(async () => {
      throw new Error('boom')
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await postCallRecap('abc123', { env, post })).toBe('failed')
    expect(db.callRecording.updateMany).toHaveBeenLastCalledWith({ where: { id: 'abc123' }, data: { recapPostedAt: null, recapChannelId: null } })
  })
  it('reports a missing token or channel', async () => {
    expect(await postCallRecap('abc123', { env: { CALL_RECAP_POST_ENABLED: '1' } })).toBe('no-token')
    db.callRecording.findUnique.mockResolvedValue({ ...published, crewId: null })
    expect(await postCallRecap('abc123', { env, post: vi.fn() })).toBe('no-channel')
  })
})
