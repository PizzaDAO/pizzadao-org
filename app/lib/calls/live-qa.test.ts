// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/lib/db')

import { prisma } from '@/app/lib/db'
import type { Settings } from '@/app/lib/settings'
import { SETTINGS, type SettingKey } from '@/app/lib/settings/registry'
import { __resetMemoryRateLimits } from '@/app/lib/rate-limit'
import { EMPTY_POST_FILTER } from './post-filters'
import { actionSchema, clearQaCache, LiveQaError, memberQaView, publishedQa, publishedQaForRecording, runLiveAction, sweepQa, type Actor, type LiveAction } from './live-qa'

const VOTES_PER_MINUTE = 40

function fakeSettings(over: Partial<Record<SettingKey, unknown>> = {}): Settings {
  return { readFailed: false, invalidKeys: [], isSet: (k) => k in over, get: ((k: SettingKey) => (k in over ? over[k] : SETTINGS[k].default)) as Settings['get'] }
}
const member: Actor = { discordId: '111111111111111', name: 'Ann', host: false }
const host: Actor = { discordId: '999999999999999', name: 'Hosty', host: true }
const ctx = (actor: Actor, now = 1_000_000, settings = fakeSettings()) => ({ sessionId: 'evt-1', actor, settings, now })
const q = vi.mocked(prisma.callLiveQuestion)
const qv = vi.mocked(prisma.callLiveQuestionVote)
const p = vi.mocked(prisma.callLivePoll)
const pv = vi.mocked(prisma.callLivePollVote)

beforeEach(() => {
  vi.clearAllMocks()
  __resetMemoryRateLimits()
  clearQaCache()
  q.count.mockResolvedValue(0 as never)
  q.findFirst.mockResolvedValue(null as never)
  q.create.mockResolvedValue({ id: 'q1' } as never)
  q.update.mockResolvedValue({} as never)
  q.updateMany.mockResolvedValue({ count: 0 } as never)
  qv.findUnique.mockResolvedValue(null as never)
  qv.create.mockResolvedValue({} as never)
  qv.deleteMany.mockResolvedValue({ count: 1 } as never)
  p.create.mockResolvedValue({ id: 'p1' } as never)
  p.update.mockResolvedValue({} as never)
  p.count.mockResolvedValue(0 as never)
  pv.upsert.mockResolvedValue({} as never)
  vi.mocked(prisma.attendanceSummary.findMany).mockResolvedValue([{ discordId: '111111111111111', memberId: 'm-ann' }] as never)
  qv.findMany.mockResolvedValue([] as never)
  pv.findMany.mockResolvedValue([] as never)
})

describe('asking', () => {
  it('stores a cleaned question with the asker and the anonymous flag', async () => {
    await runLiveAction(ctx(member), { sessionId: 'evt-1', op: 'ask', text: '  What is\nnext   week?  ', anonymous: true })
    expect(q.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ sessionId: 'evt-1', authorId: member.discordId, text: 'What is next week?', anonymous: true }) }))
  })
  it('limits the length to 280 characters and rejects tiny ones', async () => {
    await expect(runLiveAction(ctx(member), { sessionId: 'evt-1', op: 'ask', text: 'x'.repeat(281) })).rejects.toMatchObject({ status: 400, code: 'too-long' })
    await expect(runLiveAction(ctx(member), { sessionId: 'evt-1', op: 'ask', text: 'x'.repeat(280) })).resolves.toBeTruthy()
    await expect(runLiveAction(ctx(member), { sessionId: 'evt-1', op: 'ask', text: ' a ' })).rejects.toMatchObject({ status: 400, code: 'too-short' })
  })
  it('rate limits: a pause between questions and a per-call maximum (both settings)', async () => {
    q.findFirst.mockResolvedValue({ createdAt: new Date(1_000_000 - 5_000) } as never)
    await expect(runLiveAction(ctx(member), { sessionId: 'evt-1', op: 'ask', text: 'another one' })).rejects.toMatchObject({ status: 429, code: 'too-fast' })
    q.findFirst.mockResolvedValue({ createdAt: new Date(1_000_000 - 25_000) } as never)
    await expect(runLiveAction(ctx(member), { sessionId: 'evt-1', op: 'ask', text: 'another one' })).resolves.toBeTruthy()
    await expect(runLiveAction(ctx(member, 1_000_000, fakeSettings({ 'calls.liveQuestionMinGapSeconds': 60 })), { sessionId: 'evt-1', op: 'ask', text: 'another one' })).rejects.toMatchObject({ code: 'too-fast' })
    q.count.mockResolvedValue(5 as never)
    await expect(runLiveAction(ctx(member), { sessionId: 'evt-1', op: 'ask', text: 'yet another' })).rejects.toMatchObject({ status: 429, code: 'limit' })
    expect(q.count).toHaveBeenCalledWith({ where: { sessionId: 'evt-1', authorId: member.discordId } })
  })
})

describe('question votes', () => {
  beforeEach(() => q.findFirst.mockResolvedValue({ id: 'q1', hidden: false } as never))
  it('toggles: one vote per member, again removes it', async () => {
    expect(await runLiveAction(ctx(member), { sessionId: 'evt-1', op: 'vote', questionId: 'q1' })).toEqual({ voted: true })
    expect(qv.create).toHaveBeenCalledWith({ data: { questionId: 'q1', voterId: member.discordId } })
    qv.findUnique.mockResolvedValue({ questionId: 'q1' } as never)
    expect(await runLiveAction(ctx(member), { sessionId: 'evt-1', op: 'vote', questionId: 'q1' })).toEqual({ voted: false })
    expect(qv.deleteMany).toHaveBeenCalledWith({ where: { questionId: 'q1', voterId: member.discordId } })
  })
  it('a raced double tap stays one vote (unique key)', async () => {
    qv.create.mockRejectedValue({ code: 'P2002' })
    expect(await runLiveAction(ctx(member), { sessionId: 'evt-1', op: 'vote', questionId: 'q1' })).toEqual({ voted: true })
  })
  it('cannot vote on a question of another call, or a hidden one (members)', async () => {
    q.findFirst.mockResolvedValue(null as never)
    await expect(runLiveAction(ctx(member), { sessionId: 'evt-1', op: 'vote', questionId: 'zzz' })).rejects.toMatchObject({ status: 404 })
    q.findFirst.mockResolvedValue({ id: 'q1', hidden: true } as never)
    await expect(runLiveAction(ctx(member), { sessionId: 'evt-1', op: 'vote', questionId: 'q1' })).rejects.toMatchObject({ status: 404 })
    expect(q.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: 'q1', sessionId: 'evt-1' } }))
  })
  it('rate limits votes per member', async () => {
    // The shared keyed limiter (Upstash in production, per-instance memory otherwise), per member.
    for (let i = 0; i < VOTES_PER_MINUTE; i++) await runLiveAction(ctx(member), { sessionId: 'evt-1', op: 'vote', questionId: 'q1' })
    await expect(runLiveAction(ctx(member), { sessionId: 'evt-1', op: 'vote', questionId: 'q1' })).rejects.toMatchObject({ status: 429 })
    await expect(runLiveAction(ctx({ ...member, discordId: '777777777777777' }), { sessionId: 'evt-1', op: 'vote', questionId: 'q1' })).resolves.toBeTruthy()
    await expect(runLiveAction(ctx(member), { sessionId: 'evt-1', op: 'pollVote', pollId: 'p1', option: 0 })).rejects.toMatchObject({ status: 429 })
  })
})

describe('host actions', () => {
  beforeEach(() => {
    q.findFirst.mockResolvedValue({ id: 'q1' } as never)
    p.findFirst.mockResolvedValue({ id: 'p1', status: 'draft', options: ['A', 'B'] } as never)
  })
  const nonHost: LiveAction[] = [
    { sessionId: 'evt-1', op: 'moderate', questionId: 'q1', action: 'hide' },
    { sessionId: 'evt-1', op: 'moderate', questionId: 'q1', action: 'answer' },
    { sessionId: 'evt-1', op: 'moderate', questionId: 'q1', action: 'pin' },
    { sessionId: 'evt-1', op: 'createPoll', question: 'Which day?', options: ['Mon', 'Tue'] },
    { sessionId: 'evt-1', op: 'pollAction', pollId: 'p1', action: 'open' },
  ]
  it.each(nonHost)('a member cannot %j', async (action) => {
    await expect(runLiveAction(ctx(member), action)).rejects.toMatchObject({ status: 403, code: 'forbidden' })
    expect(q.update).not.toHaveBeenCalled()
    expect(p.create).not.toHaveBeenCalled()
    expect(p.update).not.toHaveBeenCalled()
  })
  it('a host can mark answered, hide and pin (one pinned at a time)', async () => {
    await runLiveAction(ctx(host), { sessionId: 'evt-1', op: 'moderate', questionId: 'q1', action: 'answer' })
    expect(q.update).toHaveBeenLastCalledWith({ where: { id: 'q1' }, data: expect.objectContaining({ answered: true, pinned: false }) })
    await runLiveAction(ctx(host), { sessionId: 'evt-1', op: 'moderate', questionId: 'q1', action: 'hide' })
    expect(q.update).toHaveBeenLastCalledWith({ where: { id: 'q1' }, data: expect.objectContaining({ hidden: true }) })
    await runLiveAction(ctx(host), { sessionId: 'evt-1', op: 'moderate', questionId: 'q1', action: 'pin' })
    expect(q.updateMany).toHaveBeenCalledWith({ where: { sessionId: 'evt-1', pinned: true }, data: { pinned: false } })
    expect(q.update).toHaveBeenLastCalledWith({ where: { id: 'q1' }, data: { pinned: true } })
  })
  it('a host cannot moderate a question of another call', async () => {
    q.findFirst.mockResolvedValue(null as never)
    await expect(runLiveAction(ctx(host), { sessionId: 'evt-1', op: 'moderate', questionId: 'other', action: 'hide' })).rejects.toMatchObject({ status: 404 })
  })
})

describe('actions are tied to the call', () => {
  it('rejects an action that names another call than the one it was checked against', async () => {
    await expect(runLiveAction(ctx(member), { sessionId: 'other-call', op: 'ask', text: 'hello there' })).rejects.toMatchObject({ status: 409, code: 'not-live' })
    expect(q.create).not.toHaveBeenCalled()
  })
  it('requires a sessionId in the schema', () => {
    expect(actionSchema.safeParse({ op: 'vote', questionId: 'q' }).success).toBe(false)
  })
  it('lets only hosts set the stream link, only to an x.com link, and clears it with null', async () => {
    const set = vi.mocked(prisma.callLiveSession.update)
    set.mockResolvedValue({} as never)
    await expect(runLiveAction(ctx(member), { sessionId: 'evt-1', op: 'setStreamLink', link: 'https://x.com/i/broadcasts/abc' })).rejects.toMatchObject({ status: 403 })
    await expect(runLiveAction(ctx(host), { sessionId: 'evt-1', op: 'setStreamLink', link: 'https://evil.test/x' })).rejects.toMatchObject({ status: 400, code: 'invalid-link' })
    expect(await runLiveAction(ctx(host), { sessionId: 'evt-1', op: 'setStreamLink', link: 'https://x.com/i/broadcasts/abc' })).toEqual({ streamLink: 'https://x.com/i/broadcasts/abc' })
    expect(set).toHaveBeenLastCalledWith({ where: { sessionId: 'evt-1' }, data: { streamLinkOverride: 'https://x.com/i/broadcasts/abc' } })
    await runLiveAction(ctx(host), { sessionId: 'evt-1', op: 'setStreamLink', link: null })
    expect(set).toHaveBeenLastCalledWith({ where: { sessionId: 'evt-1' }, data: { streamLinkOverride: null } })
  })
})

describe('atomic writes', () => {
  it('asking takes a per-session-and-member lock in a transaction before counting', async () => {
    await runLiveAction(ctx(member), { sessionId: 'evt-1', op: 'ask', text: 'hello there' })
    expect(prisma.$transaction).toHaveBeenCalled()
    expect(prisma.$executeRaw).toHaveBeenCalled()
    const order = [vi.mocked(prisma.$executeRaw).mock.invocationCallOrder[0], q.count.mock.invocationCallOrder[0]]
    expect(order[0]).toBeLessThan(order[1])
  })
  it('pinning unpins the others and pins this one in one transaction; opening a poll and voting lock too', async () => {
    q.findFirst.mockResolvedValue({ id: 'q1' } as never)
    await runLiveAction(ctx(host), { sessionId: 'evt-1', op: 'moderate', questionId: 'q1', action: 'pin' })
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    vi.mocked(prisma.$transaction).mockClear()
    vi.mocked(prisma.$executeRaw).mockClear()
    p.findFirst.mockResolvedValue({ id: 'p1', status: 'draft', options: ['A', 'B'] } as never)
    await runLiveAction(ctx(host), { sessionId: 'evt-1', op: 'pollAction', pollId: 'p1', action: 'open' })
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2) // the session lock, then the poll lock
    vi.mocked(prisma.$executeRaw).mockClear()
    p.findFirst.mockResolvedValue({ status: 'open', options: ['A', 'B'] } as never)
    await runLiveAction(ctx(member), { sessionId: 'evt-1', op: 'pollVote', pollId: 'p1', option: 0 })
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1)
  })
  it('a vote that arrives after the close is refused (checked under the same lock)', async () => {
    p.findFirst.mockResolvedValue({ status: 'closed', options: ['A', 'B'] } as never)
    await expect(runLiveAction(ctx(member), { sessionId: 'evt-1', op: 'pollVote', pollId: 'p1', option: 0 })).rejects.toMatchObject({ status: 409, code: 'closed' })
    expect(pv.upsert).not.toHaveBeenCalled()
  })
})

describe('polls', () => {
  it('validates 2 to 6 distinct options', async () => {
    expect(actionSchema.safeParse({ sessionId: 'evt-1', op: 'createPoll', question: 'Q?', options: ['a'] }).success).toBe(false)
    expect(actionSchema.safeParse({ sessionId: 'evt-1', op: 'createPoll', question: 'Q?', options: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }).success).toBe(false)
    await expect(runLiveAction(ctx(host), { sessionId: 'evt-1', op: 'createPoll', question: 'Which?', options: ['Same', 'same'] })).rejects.toMatchObject({ code: 'invalid-poll' })
    await expect(runLiveAction(ctx(host), { sessionId: 'evt-1', op: 'createPoll', question: 'Which?', options: ['  ', 'only'] })).rejects.toMatchObject({ code: 'invalid-poll' })
    expect(await runLiveAction(ctx(host), { sessionId: 'evt-1', op: 'createPoll', question: 'Which day?', options: ['Mon', 'Tue'], showResults: true })).toEqual({ id: 'p1' })
    expect(p.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'draft', showResults: true, createdBy: host.discordId }) }))
  })
  it('opens a draft once, only one open poll at a time, and closes an open one', async () => {
    p.findFirst.mockResolvedValue({ id: 'p1', status: 'draft' } as never)
    await runLiveAction(ctx(host), { sessionId: 'evt-1', op: 'pollAction', pollId: 'p1', action: 'open' })
    expect(p.update).toHaveBeenLastCalledWith({ where: { id: 'p1' }, data: expect.objectContaining({ status: 'open' }) })
    p.count.mockResolvedValue(1 as never)
    await expect(runLiveAction(ctx(host), { sessionId: 'evt-1', op: 'pollAction', pollId: 'p1', action: 'open' })).rejects.toMatchObject({ status: 409, code: 'another-open' })
    p.findFirst.mockResolvedValue({ id: 'p1', status: 'open' } as never)
    await runLiveAction(ctx(host), { sessionId: 'evt-1', op: 'pollAction', pollId: 'p1', action: 'close' })
    expect(p.update).toHaveBeenLastCalledWith({ where: { id: 'p1' }, data: expect.objectContaining({ status: 'closed' }) })
  })
  it('members vote once per poll (upsert on the member key), changeable while open', async () => {
    p.findFirst.mockResolvedValue({ status: 'open', options: ['A', 'B'] } as never)
    await runLiveAction(ctx(member), { sessionId: 'evt-1', op: 'pollVote', pollId: 'p1', option: 0 })
    await runLiveAction(ctx(member), { sessionId: 'evt-1', op: 'pollVote', pollId: 'p1', option: 1 })
    expect(pv.upsert).toHaveBeenLastCalledWith({
      where: { pollId_voterId: { pollId: 'p1', voterId: member.discordId } },
      create: { pollId: 'p1', voterId: member.discordId, optionIndex: 1 },
      update: { optionIndex: 1 },
    })
  })
  it('rejects votes on closed or draft polls and out of range options', async () => {
    p.findFirst.mockResolvedValue({ status: 'closed', options: ['A', 'B'] } as never)
    await expect(runLiveAction(ctx(member), { sessionId: 'evt-1', op: 'pollVote', pollId: 'p1', option: 0 })).rejects.toMatchObject({ status: 409 })
    p.findFirst.mockResolvedValue({ status: 'draft', options: ['A', 'B'] } as never)
    await expect(runLiveAction(ctx(member), { sessionId: 'evt-1', op: 'pollVote', pollId: 'p1', option: 0 })).rejects.toMatchObject({ status: 404 })
    p.findFirst.mockResolvedValue({ status: 'open', options: ['A', 'B'] } as never)
    await expect(runLiveAction(ctx(member), { sessionId: 'evt-1', op: 'pollVote', pollId: 'p1', option: 5 })).rejects.toMatchObject({ code: 'bad-option' })
    expect(pv.upsert).not.toHaveBeenCalled()
  })
})

const question = (id: string, over: Record<string, unknown> = {}) => ({
  id, sessionId: 'evt-1', authorId: '111111111111111', authorName: 'Ann', text: `q ${id}`, anonymous: false, answered: false, pinned: false, hidden: false,
  createdAt: new Date(1000), votes: [{ voterId: 'a' }, { voterId: '999' }], _count: { votes: 2 }, ...over,
})

describe('anonymity', () => {
  beforeEach(() => {
    q.findMany.mockResolvedValue([question('open'), question('anon', { anonymous: true, authorId: '222222222222222', authorName: 'Secret Sam' })] as never)
    p.findMany.mockResolvedValue([] as never)
  })
  it('never names an anonymous asker to a member (no name, no id, no link)', async () => {
    const out = await memberQaView('evt-1', { discordId: '555555555555555', host: false }, EMPTY_POST_FILTER)
    const anon = out.questions.find((x) => x.id === 'anon')!
    expect(anon.anonymous).toBe(true)
    expect(anon.author).toBeNull()
    const json = JSON.stringify(out)
    expect(json).not.toContain('Secret Sam')
    expect(json).not.toContain('222222222222222')
    // a non-anonymous asker is named and linked
    expect(out.questions.find((x) => x.id === 'open')!.author).toEqual({ name: 'Ann', memberId: 'm-ann' })
  })
  it('lets the asker know it is theirs without exposing the id', async () => {
    const out = await memberQaView('evt-1', { discordId: '222222222222222', host: false }, EMPTY_POST_FILTER)
    expect(out.questions.find((x) => x.id === 'anon')!.mine).toBe(true)
    expect(JSON.stringify(out)).not.toContain('Secret Sam')
  })
  it('shows hosts the name of an anonymous asker, but never as a link', async () => {
    const out = await memberQaView('evt-1', { discordId: '999999999999999', host: true }, EMPTY_POST_FILTER)
    expect(out.questions.find((x) => x.id === 'anon')!.author).toEqual({ name: 'Secret Sam', memberId: null })
  })
  it('does not resolve a profile for an anonymous asker', async () => {
    await memberQaView('evt-1', { discordId: '555555555555555', host: false }, EMPTY_POST_FILTER)
    const asked = (vi.mocked(prisma.attendanceSummary.findMany).mock.calls[0][0] as { where: { discordId: { in: string[] } } }).where.discordId.in
    expect(asked).not.toContain('222222222222222')
  })
  it('hides moderated questions and draft polls from members but not from hosts', async () => {
    q.findMany.mockResolvedValue([question('ok'), question('mod', { hidden: true })] as never)
    p.findMany.mockResolvedValue([
      { id: 'd', question: 'Draft?', status: 'draft', showResults: false, options: ['A', 'B'], createdBy: '9', createdByName: null, votes: [] },
      { id: 'o', question: 'Open?', status: 'open', showResults: false, options: ['A', 'B'], createdBy: '9', createdByName: null, votes: [] },
    ] as never)
    const m = await memberQaView('evt-1', { discordId: '555555555555555', host: false }, EMPTY_POST_FILTER)
    expect(m.questions.map((x) => x.id)).toEqual(['ok'])
    expect(m.polls.map((x) => x.id)).toEqual(['o'])
    clearQaCache()
    const h = await memberQaView('evt-1', { discordId: '999999999999999', host: true }, EMPTY_POST_FILTER)
    expect(h.questions.map((x) => x.id)).toEqual(['ok', 'mod'])
    expect(h.questions.find((x) => x.id === 'mod')!.hidden).toBe(true)
    expect(h.polls.map((x) => x.id)).toEqual(['d', 'o'])
  })

  it('drops questions and polls with a blocked term on read, and nothing leaks into the shared view', async () => {
    q.findMany.mockResolvedValue([question('ok'), question('bad', { text: 'what about the secret plan' })] as never)
    p.findMany.mockResolvedValue([
      { id: 'p1', question: 'Fine?', status: 'open', showResults: true, options: ['yes', 'the secret'], createdBy: '9', createdByName: null, votes: [] },
      { id: 'p2', question: 'Ok?', status: 'open', showResults: true, options: ['a', 'b'], createdBy: '9', createdByName: null, votes: [] },
    ] as never)
    const out = await memberQaView('evt-1', { discordId: '5', host: true }, { ...EMPTY_POST_FILTER, blockedTerms: ['secret'] })
    expect(out.questions.map((x) => x.id)).toEqual(['ok'])
    expect(out.polls.map((x) => x.id)).toEqual(['p2'])
  })

  it('builds the shared view once for several viewers and reads only each viewer\'s own votes', async () => {
    q.findMany.mockResolvedValue([question('ok')] as never)
    p.findMany.mockResolvedValue([] as never)
    qv.findMany.mockResolvedValue([{ questionId: 'ok' }] as never)
    const a = await memberQaView('evt-1', { discordId: 'a', host: false }, EMPTY_POST_FILTER, 1_000)
    await memberQaView('evt-1', { discordId: 'b', host: false }, EMPTY_POST_FILTER, 2_000)
    expect(q.findMany).toHaveBeenCalledTimes(1)
    expect(qv.findMany).toHaveBeenCalledTimes(2)
    expect(qv.findMany.mock.calls[1][0]).toMatchObject({ where: { voterId: 'b' } })
    expect(a.questions[0].voted).toBe(true)
    await memberQaView('evt-1', { discordId: 'c', host: false }, EMPTY_POST_FILTER, 5_000)
    expect(q.findMany).toHaveBeenCalledTimes(2)
  })
})

describe('poll results visibility', () => {
  const poll = (status: string, showResults: boolean) => ({
    id: 'p1', question: 'Which?', status, showResults, options: ['A', 'B'], createdBy: '999999999999999', createdByName: 'Hosty',
    votes: [{ optionIndex: 0 }, { optionIndex: 0 }, { optionIndex: 1 }, { optionIndex: 1 }],
  })
  beforeEach(() => {
    q.findMany.mockResolvedValue([] as never)
    pv.findMany.mockResolvedValue([{ pollId: 'p1', optionIndex: 1 }] as never)
  })
  it('hides counts from members while open unless the host allowed it; hosts always see them', async () => {
    p.findMany.mockResolvedValue([poll('open', false)] as never)
    const m = (await memberQaView('evt-1', { discordId: '111111111111111', host: false }, EMPTY_POST_FILTER)).polls[0]
    expect(m.total).toBeNull()
    expect(m.options.every((o) => o.votes === null && o.percent === null)).toBe(true)
    expect(m.myVote).toBe(1)
    const h = (await memberQaView('evt-1', { discordId: '999999999999999', host: true }, EMPTY_POST_FILTER)).polls[0]
    expect(h.total).toBe(4)
    expect(h.options.map((o) => o.percent)).toEqual([50, 50])
  })
  it('shows counts to members when the host allowed it, and always once closed', async () => {
    p.findMany.mockResolvedValue([poll('open', true)] as never)
    expect((await memberQaView('evt-1', { discordId: '5', host: false }, EMPTY_POST_FILTER)).polls[0].total).toBe(4)
    p.findMany.mockResolvedValue([poll('closed', false)] as never)
    expect((await memberQaView('evt-1', { discordId: '5', host: false }, EMPTY_POST_FILTER)).polls[0].total).toBe(4)
  })
  it('links the poll creator to their profile only when known', async () => {
    p.findMany.mockResolvedValue([poll('open', true)] as never)
    vi.mocked(prisma.attendanceSummary.findMany).mockResolvedValue([{ discordId: '999999999999999', memberId: 'm-host' }] as never)
    expect((await memberQaView('evt-1', { discordId: '5', host: false }, EMPTY_POST_FILTER)).polls[0].createdBy).toEqual({ name: 'Hosty', memberId: 'm-host' })
  })
})

describe('published call page', () => {
  it('never names anonymous askers, leaves out hidden ones, drops redacted authors and sorts by votes', async () => {
    q.findMany.mockResolvedValue([
      question('a', { votes: [{ voterId: '1' }] }),
      question('b', { votes: [{ voterId: '1' }, { voterId: '2' }, { voterId: '3' }], answered: true }),
      question('anon', { anonymous: true, authorName: 'Secret Sam', authorId: '222222222222222' }),
      question('redacted', { authorId: '333333333333333', authorName: 'Redacted Rae' }),
    ] as never)
    p.findMany.mockResolvedValue([] as never)
    const out = await publishedQa('evt-1', ['333333333333333'], EMPTY_POST_FILTER)
    expect(q.findMany.mock.calls[0][0]).toMatchObject({ where: { sessionId: 'evt-1', hidden: false } })
    expect(out.answered.map((x) => x.id)).toEqual(['b'])
    expect(out.unanswered.map((x) => x.id)).toEqual(['anon', 'a']) // 2 votes, then 1
    expect(out.unanswered.find((x) => x.id === 'anon')!.author).toBeNull()
    const json = JSON.stringify(out)
    expect(json).not.toContain('Secret Sam')
    expect(json).not.toContain('Redacted Rae')
    expect(out.answered[0].votes).toBe(3)
  })
  it('shows poll results (not drafts) with percentages', async () => {
    q.findMany.mockResolvedValue([] as never)
    p.findMany.mockResolvedValue([{ id: 'p1', question: 'Which?', options: ['A', 'B'], votes: [{ voterId: '1', optionIndex: 0 }, { voterId: '2', optionIndex: 0 }, { voterId: '3', optionIndex: 1 }] }] as never)
    const out = await publishedQa('evt-1', [], EMPTY_POST_FILTER)
    expect(p.findMany.mock.calls[0][0]).toMatchObject({ where: { sessionId: 'evt-1', status: { not: 'draft' } } })
    expect(out.polls[0]).toMatchObject({ total: 3, options: [{ text: 'A', votes: 2, percent: 67 }, { text: 'B', votes: 1, percent: 33 }] })
  })
  it('is null when the recording is not published or has nothing, and never throws', async () => {
    vi.mocked(prisma.callRecording.findFirst).mockResolvedValue(null as never)
    expect(await publishedQaForRecording('r1', async () => EMPTY_POST_FILTER)).toBeNull()
    vi.mocked(prisma.callRecording.findFirst).mockResolvedValue({ sessionId: 'evt-1', redactedSpeakerIds: [] } as never)
    q.findMany.mockResolvedValue([] as never)
    p.findMany.mockResolvedValue([] as never)
    expect(await publishedQaForRecording('r1', async () => EMPTY_POST_FILTER)).toBeNull()
    vi.mocked(prisma.callRecording.findFirst).mockRejectedValue(new Error('db'))
    expect(await publishedQaForRecording('r1', async () => EMPTY_POST_FILTER)).toBeNull()
  })
})

describe('published call page: blocked terms and the filter', () => {
  it('drops blocked questions and polls, and shows nothing when the filter cannot be read', async () => {
    q.findMany.mockResolvedValue([question('ok'), question('bad', { text: 'the secret plan' })] as never)
    p.findMany.mockResolvedValue([{ id: 'p1', question: 'The secret?', options: ['a', 'b'], createdBy: '9', votes: [] }] as never)
    const out = await publishedQa('evt-1', [], { ...EMPTY_POST_FILTER, blockedTerms: ['secret'] })
    expect(out.unanswered.map((x) => x.id)).toEqual(['ok'])
    expect(out.polls).toEqual([])
    vi.mocked(prisma.callRecording.findFirst).mockResolvedValue({ sessionId: 'evt-1', redactedSpeakerIds: [] } as never)
    expect(await publishedQaForRecording('r1', async () => { throw new Error('down') })).toBeNull()
  })
})

describe('sweepQa', () => {
  it('deletes Q&A and polls of old calls with no published recording, keeps the rest', async () => {
    q.findMany.mockResolvedValue([{ sessionId: 's-old' }, { sessionId: 's-pub' }] as never)
    p.findMany.mockResolvedValue([{ sessionId: 's-old' }] as never)
    vi.mocked(prisma.callRecording.findMany).mockResolvedValue([{ sessionId: 's-pub' }] as never)
    q.deleteMany.mockResolvedValue({ count: 3 } as never)
    vi.mocked(prisma.callLivePoll.deleteMany).mockResolvedValue({ count: 1 } as never)
    expect(await sweepQa(100 * 86_400_000, 30)).toBe(4)
    expect(q.findMany.mock.calls[0][0]).toMatchObject({ where: { createdAt: { lt: new Date(70 * 86_400_000) } } })
    expect(vi.mocked(prisma.callRecording.findMany).mock.calls[0][0]).toMatchObject({ where: { status: 'PUBLISHED' } })
    expect(q.deleteMany).toHaveBeenCalledWith({ where: { sessionId: { in: ['s-old'] } } })
  })
  it('never throws', async () => {
    q.findMany.mockRejectedValue(new Error('db'))
    expect(await sweepQa(1, 30)).toBe(0)
  })
})

describe('LiveQaError', () => {
  it('carries a status and code', () => {
    const e = new LiveQaError(429, 'limit')
    expect([e.status, e.code]).toEqual([429, 'limit'])
  })
})
