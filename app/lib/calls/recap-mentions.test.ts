// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/db')
vi.mock('@/app/lib/crew-mappings', () => ({ getCrewMappings: vi.fn(async () => ({ cached: true, crews: [] })) }))
vi.mock('@/app/lib/telegram/city-posts', () => ({ enqueueMirror: vi.fn(async () => ({ queued: 0, reason: 'error' })) }))
vi.mock('@/app/lib/discord-channels', () => ({ resolveChannelId: vi.fn(async () => null) }))

import { prisma } from '@/app/lib/db'
import { enqueueMirror } from '@/app/lib/telegram/city-posts'
import { clearPostFilterCache } from './post-filters'
import { buildRecapParts, buildRecapText, mentionInBullet, mentionNames, loadRecapPeople, recapAllowedMentions, repostRecap, postCallRecap, resolveMentionId, type RecapPeople } from './recap'

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>
const base = 'https://example.org'
const ENZO = '111111111111111111'
const ANN = '222222222222222222'
const ANN2 = '333333333333333333'
const BOT = '444444444444444444'
const MEM = '555555555555555555'

const people: RecapPeople = {
  speakers: [
    { discordId: ENZO, displayName: 'Enzo Pepperoni 🍫' },
    { discordId: ANN, displayName: 'Ann Anchovy' },
    { discordId: ANN2, displayName: 'Ann Basil' },
    { discordId: BOT, displayName: 'Metalhead' },
  ],
  members: [{ discordId: MEM, name: 'Lou Olive' }],
}

beforeEach(() => {
  vi.clearAllMocks()
  clearPostFilterCache()
  db.appSetting.findMany.mockResolvedValue([])
})

describe('resolveMentionId', () => {
  it('matches a speaker by full name, ignoring case and decoration', () => {
    expect(resolveMentionId('enzo pepperoni', people)).toBe(ENZO)
    expect(resolveMentionId('Ann Anchovy', people)).toBe(ANN)
  })
  it('matches a first word only when it is unique among the speakers', () => {
    expect(resolveMentionId('Enzo', people)).toBe(ENZO)
    expect(resolveMentionId('Ann', people)).toBeNull()
  })
  it('falls back to the members directory (exact only)', () => {
    expect(resolveMentionId('lou olive', people)).toBe(MEM)
    expect(resolveMentionId('Lou', people)).toBeNull()
  })
  it('never resolves bots, Metalhead or Claude, nor unknown names', () => {
    expect(resolveMentionId('Metalhead', people)).toBeNull()
    expect(resolveMentionId('Claude', { speakers: [{ discordId: ENZO, displayName: 'Claude' }], members: [] })).toBeNull()
    expect(resolveMentionId('Pizza Bot', { speakers: [{ discordId: ENZO, displayName: 'Pizza Bot' }], members: [] })).toBeNull()
    expect(resolveMentionId('Nobody', people)).toBeNull()
  })
  it('skips speakers without a real id (guests)', () => {
    expect(resolveMentionId('Guest', { speakers: [{ discordId: 'speaker-1', displayName: 'Guest' }], members: [] })).toBeNull()
  })
})

describe('mentionNames / bullets', () => {
  it('mentions each resolvable name in an owner field and leaves the rest', () => {
    expect(mentionNames('Enzo & Nobody', people)).toBe(`<@${ENZO}> & Nobody`)
    expect(mentionNames('Metalhead', people)).toBe('Metalhead')
  })
  it('replaces only the first whole-word occurrence per speaker per bullet', () => {
    const out = mentionInBullet('Enzo thanked Enzo Pepperoni and Ann Basil, then enzo left.', people)
    expect(out).toBe(`<@${ENZO}> thanked Enzo Pepperoni and <@${ANN2}>, then enzo left.`)
  })
  it('is whole-word, case-insensitive, and leaves bots and ambiguous first names alone', () => {
    expect(mentionInBullet('Lorenzo and ENZO met Ann and Metalhead.', people)).toBe(`Lorenzo and <@${ENZO}> met Ann and Metalhead.`)
  })
})

describe('allowed_mentions', () => {
  const ids = Array.from({ length: 30 }, (_, i) => `1000000000000000${String(i).padStart(2, '0')}`)
  it('lists unique mentioned users (max 25) when pinging', () => {
    const a = recapAllowedMentions([ENZO, ENZO, ANN], true)
    expect(a).toEqual({ parse: [], users: [ENZO, ANN] })
    expect(recapAllowedMentions(ids, true).users).toHaveLength(25)
  })
  it('has no users when ping is off or nobody is mentioned', () => {
    expect(recapAllowedMentions([ENZO], false)).toEqual({ parse: [] })
    expect(recapAllowedMentions([], true)).toEqual({ parse: [] })
  })
})

describe('buildRecapText with mentions', () => {
  const rec = {
    id: 'abc123',
    title: 'Ops sync',
    crewLabel: 'Ops',
    summary: 'Enzo reviewed the launch plan. The budget was approved. Lou Olive will own the vendor list. Next call moves to Thursday.',
    actionItems: [{ text: 'Send the deck', owner: 'Enzo', suggestedBy: 'Lou Olive' }, { text: 'Ask the AI', owner: 'Claude' }],
    chapters: [],
  }
  it('puts mentions in bullets and action items; the plain text has names', () => {
    const t = buildRecapText(rec, base, undefined, undefined, people)
    expect(t).toContain(`- <@${ENZO}> reviewed the launch plan.`)
    expect(t).toContain(`- Send the deck (<@${ENZO}>) — suggested by <@${MEM}>`)
    expect(t).toContain('- Ask the AI (Claude)')
    expect(buildRecapText(rec, base)).not.toContain('<@')
  })
  it('keeps the 2000 character limit with mentions', () => {
    const long = Array.from({ length: 40 }, () => `Enzo said ${'x'.repeat(250)}.`).join(' ')
    const t = buildRecapText({ ...rec, summary: long, actionItems: Array.from({ length: 30 }, () => ({ text: 'y'.repeat(200), owner: 'Enzo' })) }, base, undefined, { bullets: 40, actions: 30, chars: 300 }, people)
    expect(t.length).toBeLessThanOrEqual(2000)
    expect(t).toContain('/calls/abc123')
  })
})

describe('posting and editing', () => {
  const env = { CALL_RECAP_POST_ENABLED: '1', DISCORD_BOT_TOKEN: 'tok' }
  const published = {
    id: 'abc123', title: 'Ops sync', crewLabel: 'Ops', crewId: 'community_call', eventName: null, status: 'PUBLISHED', source: null,
    summary: 'Enzo reviewed the launch plan. The budget was approved. Ann Anchovy will own the vendor list. Next call moves to Thursday.',
    actionItems: [{ text: 'Send the deck', owner: 'Enzo' }], chapters: [],
    recapPostedAt: null, recapChannelId: null, recapMessageId: null, redactionsUpdatedAt: null, summaryGeneratedAt: null, summaryEditedAt: null,
  }
  const speakerRows = [
    { discordId: ENZO, linkedDiscordId: null, displayName: 'Enzo Pepperoni 🍫' },
    { discordId: ANN, linkedDiscordId: null, displayName: 'Ann Anchovy' },
  ]

  it('posts mentions that ping by default; Telegram gets plain names', async () => {
    db.callRecording.findUnique.mockResolvedValue(published)
    db.callRecording.updateMany.mockResolvedValue({ count: 1 })
    db.callRecording.update.mockResolvedValue({})
    db.callSpeaker.findMany.mockResolvedValue(speakerRows)
    const post = vi.fn(async () => ({ id: 'm1' }))
    expect(await postCallRecap('abc123', { env, post, base })).toBe('posted')
    const body = (post.mock.calls[0] as unknown as [unknown, { content: string; allowed_mentions: unknown }])[1]
    expect(body.content).toContain(`<@${ENZO}> reviewed`)
    expect(body.allowed_mentions).toEqual({ parse: [], users: [ENZO, ANN] })
    const tg = vi.mocked(enqueueMirror).mock.calls[0][0].text
    expect(tg).not.toContain('<@')
    expect(tg).toContain('Enzo reviewed the launch plan.')
  })
  it('shows mentions without notifying when the env kill switch is on', async () => {
    db.callRecording.findUnique.mockResolvedValue(published)
    db.callRecording.updateMany.mockResolvedValue({ count: 1 })
    db.callRecording.update.mockResolvedValue({})
    db.callSpeaker.findMany.mockResolvedValue(speakerRows)
    const post = vi.fn(async () => ({ id: 'm1' }))
    await postCallRecap('abc123', { env: { ...env, CALL_RECAP_MENTION_PING_ENABLED: '0' }, post, base })
    const body = (post.mock.calls[0] as unknown as [unknown, { content: string; allowed_mentions: unknown }])[1]
    expect(body.content).toContain(`<@${ENZO}>`)
    expect(body.allowed_mentions).toEqual({ parse: [] })
  })

  it('edit: re-renders and edits the stored message, without posting or mirroring', async () => {
    db.callRecording.findUnique.mockResolvedValue({ ...published, recapPostedAt: new Date(), recapChannelId: '812143244149915679', recapMessageId: '999999999999999999' })
    db.callSpeaker.findMany.mockResolvedValue(speakerRows)
    const edit = vi.fn(async () => {})
    const post = vi.fn()
    expect(await repostRecap('abc123', { edit: true }, { env, edit, post, base })).toBe('updated')
    expect(post).not.toHaveBeenCalled()
    expect(enqueueMirror).not.toHaveBeenCalled()
    const [target, body] = edit.mock.calls[0] as unknown as [{ channelId: string; messageId: string; botToken: string }, { content: string; allowed_mentions: unknown }]
    expect(target).toEqual({ channelId: '812143244149915679', messageId: '999999999999999999', botToken: 'tok' })
    expect(body.content).toContain(`<@${ENZO}> reviewed`)
    expect(body.allowed_mentions).toEqual({ parse: [], users: [ENZO, ANN] })
  })
  it('edit: reports what is missing when the message id was never stored', async () => {
    db.callRecording.findUnique.mockResolvedValue({ ...published, recapPostedAt: new Date(), recapChannelId: '812143244149915679', recapMessageId: null })
    const edit = vi.fn()
    expect(await repostRecap('abc123', { edit: true }, { env, edit })).toBe('no-message')
    expect(edit).not.toHaveBeenCalled()
  })
  it('edit: clears its own error note on success', async () => {
    db.callRecording.findUnique.mockResolvedValue({ ...published, recapPostedAt: new Date(), recapChannelId: '812143244149915679', recapMessageId: '999999999999999999' })
    db.callRecording.updateMany.mockResolvedValue({ count: 1 })
    db.callSpeaker.findMany.mockResolvedValue(speakerRows)
    expect(await repostRecap('abc123', { edit: true }, { env, edit: vi.fn(async () => {}) })).toBe('updated')
    expect(db.callRecording.updateMany).toHaveBeenCalledWith({ where: { id: 'abc123', recapError: { startsWith: 'edit failed: ' } }, data: { recapError: null } })
  })
  it('edit: respects the posting switch and the env kill switch', async () => {
    const edit = vi.fn()
    expect(await repostRecap('abc123', { edit: true }, { env: { DISCORD_BOT_TOKEN: 'tok' }, edit })).toBe('disabled')
    expect(await repostRecap('abc123', { edit: true }, { env: { ...env, CALL_RECAP_POST_ENABLED: '0' }, edit })).toBe('disabled')
    expect(edit).not.toHaveBeenCalled()
  })
  it('edit: a Discord failure is recorded and reported', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    db.callRecording.findUnique.mockResolvedValue({ ...published, recapPostedAt: new Date(), recapChannelId: '812143244149915679', recapMessageId: '999999999999999999' })
    db.callRecording.updateMany.mockResolvedValue({ count: 1 })
    db.callSpeaker.findMany.mockResolvedValue(speakerRows)
    expect(await repostRecap('abc123', { edit: true }, { env, edit: vi.fn(async () => { throw new Error('boom') }) })).toBe('failed')
    expect(db.callRecording.updateMany).toHaveBeenCalledWith({ where: { id: 'abc123', OR: [{ recapError: null }, { recapError: { startsWith: 'edit failed: ' } }] }, data: { recapError: 'edit failed: boom' } })
  })
})

describe('safety', () => {
  const rec = { id: 'abc123', title: 'Ops <@999999999999999999>', crewLabel: 'Ops', summary: 'Enzo reviewed the plan with <@999999999999999999> and <@&888888888888888888>. The budget was approved. Everything is on track. Next call moves.', actionItems: [{ text: 'Ping <@!999999999999999999>', owner: '<@999999999999999999>', suggestedBy: `<@${ENZO}>` }], chapters: [] }
  it('neutralizes injected mentions and pings only ids the code inserted', () => {
    const parts = buildRecapParts(rec, base, undefined, undefined, people)
    expect(parts.text).not.toContain('999999999999999999')
    expect(parts.text).not.toContain('888888888888888888')
    expect(parts.text).toContain('@user')
    // a known speaker's injected mention becomes their name, then the code mentions them itself
    expect([...parts.mentions.keys()]).toEqual([ENZO])
    expect(recapAllowedMentions([...parts.mentions.keys()], true)).toEqual({ parse: [], users: [ENZO] })
    expect(buildRecapParts(rec, base).text).not.toContain('<@')
  })
  it('never mentions redacted speakers or the imported-call speakers (people loading)', async () => {
    db.callSpeaker.findMany.mockResolvedValue([
      { discordId: ENZO, linkedDiscordId: null, displayName: 'Enzo Pepperoni' },
      { discordId: ANN, linkedDiscordId: ANN2, displayName: 'Ann Anchovy' },
    ])
    db.member.findMany.mockResolvedValue([{ discordId: ANN2, name: 'Ann Anchovy' }, { discordId: MEM, name: 'Ann Anchovy 🍕' }])
    const p = await loadRecapPeople({ id: 'r', source: null, actionItems: [{ text: 'x', owner: 'Ann Anchovy' }], redactedSpeakerIds: [ANN] })
    expect(p.speakers.map((s) => s.discordId)).toEqual([ENZO])
    expect(p.members.map((m) => m.discordId)).toEqual([MEM])
    db.callSpeaker.findMany.mockClear()
    expect(await loadRecapPeople({ id: 'r', source: 'X_BROADCAST', actionItems: [], redactedSpeakerIds: [] })).toEqual({ speakers: [], members: [] })
    expect(db.callSpeaker.findMany).not.toHaveBeenCalled()
  })
  it('does not resolve placeholder owners or ambiguous directory names', () => {
    const p: RecapPeople = { speakers: [], members: [{ discordId: ANN, name: 'Team' }, { discordId: MEM, name: 'Lou' }, { discordId: ANN2, name: 'Lou 🍕' }] }
    for (const n of ['Team', 'Everyone', 'TBD', 'All', 'Anyone']) expect(resolveMentionId(n, p)).toBeNull()
    expect(resolveMentionId('Lou', p)).toBeNull()
  })
})

describe('wrong-person matching', () => {
  const ppl = (...names: string[]): RecapPeople => ({ speakers: names.map((n, i) => ({ discordId: `70000000000000000${i}`, displayName: n })), members: [] })
  it('prefers the longest name: "Ann Basil" vs "Ann"', () => {
    const p = ppl('Ann Basil', 'Ann')
    expect(mentionInBullet('Ann Basil and Ann spoke.', p)).toBe('<@700000000000000000> and <@700000000000000001> spoke.')
  })
  it('takes a first word only when nobody else shares it', () => {
    expect(mentionInBullet('Ann spoke.', ppl('Ann Basil', 'Ann Pepper'))).toBe('Ann spoke.')
    expect(mentionInBullet('Ann spoke.', ppl('Ann Basil', 'Bo'))).toBe('<@700000000000000000> spoke.')
  })
  it('ignores common words: The Don, Pizza Pete, Will', () => {
    expect(mentionInBullet('the don said pizza is great and will ship; Will Smith agreed', ppl('The Don', 'Pizza Pete', 'Will Smith'))).toBe('the don said pizza is great and will ship; <@700000000000000002> agreed')
    expect(mentionInBullet('Pizza night and Will do it.', ppl('Pizza Pete', 'Will Smith'))).toBe('Pizza night and Will do it.')
    expect(mentionInBullet('The Don agreed with Pizza Pete.', ppl('The Don', 'Pizza Pete'))).toBe('<@700000000000000000> agreed with <@700000000000000001>.')
  })
  it('needs a capital', () => {
    expect(mentionInBullet('enzo left', people)).toBe('enzo left')
    expect(mentionInBullet('ENZO left', people)).toBe(`<@${ENZO}> left`)
  })
})

describe('owner who is also the suggester', () => {
  it('mentions once and pings the id once when both names resolve to the same person', () => {
    const { text, mentions } = buildRecapParts({ id: 'r1', title: 'T', crewLabel: 'C', summary: null, actionItems: [{ text: 'Do it', owner: 'Enzo Pepperoni', suggestedBy: 'Enzo' }, { text: 'Other', owner: 'Enzo Pepperoni', suggestedBy: 'Lou Olive' }] }, base, undefined, undefined, people)
    expect(text).toContain(`- Do it \u2014 <@${ENZO}> (suggested, owner)`)
    expect(text).toContain(`- Other (<@${ENZO}>) \u2014 suggested by <@${MEM}>`)
    expect([...mentions.keys()].sort()).toEqual([ENZO, MEM].sort())
  })
})
