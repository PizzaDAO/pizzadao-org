// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/lib/db')
vi.mock('next/server', () => ({ after: (fn: () => unknown) => void fn() }))
vi.mock('@/app/lib/crew-leads', () => ({ canManageCrew: vi.fn(async () => false) }))
vi.mock('./run', () => ({ nudgeMoved: vi.fn(async () => 'posted') }))
vi.mock('@/app/lib/sheets-import/source', () => ({ usesDb: vi.fn(async () => true) }))
vi.mock('./config', async (orig) => ({ ...(await orig<typeof import('./config')>()), loadTaskProposalConfig: vi.fn() }))
vi.mock('@/app/lib/calls/post-filters', async (orig) => ({ ...(await orig<typeof import('@/app/lib/calls/post-filters')>()), loadPostFilter: vi.fn() }))
vi.mock('./cards', async (orig) => ({ ...(await orig<typeof import('./cards')>()), queueTaskProposalCardSync: vi.fn() }))
vi.mock('@/app/lib/crew-mappings', async (orig) => ({
  ...(await orig<typeof import('@/app/lib/crew-mappings')>()),
  invalidateCrewMappingsCache: vi.fn(async () => {}),
  getCrewMappings: vi.fn(async () => ({ cached: true, crews: [{ id: 'ops', label: 'Ops', type: 'crew', turtles: [] }, { id: 'tech', label: 'Tech', type: 'crew', turtles: [] }] })),
}))

import { prisma } from '@/app/lib/db'
import { canManageCrew } from '@/app/lib/crew-leads'
import { EMPTY_POST_FILTER, loadPostFilter } from '@/app/lib/calls/post-filters'
import { DiscordPostError } from '@/app/lib/discord-rest'
import { loadTaskProposalConfig, type TaskProposalConfig } from './config'
import { undoRetire } from './apply'
import { AUTO_APPLY_ACTOR } from './cards'
import { autoApplyDue, autoApplyForRecording, postActionItemSummary, renderActionItemSummary, SUMMARY_MAX, type SummaryItem } from './auto-apply'

const prop = vi.mocked(prisma.crewTaskProposal)
const task = vi.mocked(prisma.crewTask)
const rec = vi.mocked(prisma.callRecording)
const auto = vi.mocked(prisma.callTaskAutoApply)

const ON: TaskProposalConfig = { enabled: true, crews: ['ops'], maxPerCall: 15, maxDays: 14, model: '', nudge: false, autoApply: true }
const BASE = new Date('2026-11-01T00:00:00Z')
const SINCE = new Date('2026-11-10T00:00:00Z')
const APP = 'https://app.example.test'
const QUOTE = 'the secret transcript sentence'

const call = (over: Record<string, unknown> = {}) => ({
  id: 'rec1', updatedAt: new Date('2026-11-18T09:00:00Z'), source: 'DISCORD', status: 'PUBLISHED', crewId: 'ops', crewLabel: 'Ops', eventName: null, title: 'Weekly sync', startedAt: new Date('2026-11-17T18:00:00Z'),
  summary: 'A summary', actionItems: [], chapters: [], transcript: [], redactedSpeakerIds: [], redactedSegmentIds: [], reviewHoldAt: null, ...over,
})
const proposal = (over: Record<string, unknown> = {}) => ({
  id: 'p1', recordingId: 'rec1', crewId: 'ops', kind: 'CREATE', taskId: null, baseUpdatedAt: null, createdAt: new Date('2026-11-18T10:00:00Z'),
  changes: { label: { from: null, to: 'Book the venue' }, stage: { from: null, to: 'doing' }, leadName: { from: null, to: 'Ann' }, leadMemberId: { from: null, to: '12' } },
  edited: null, leadName: 'Ann', leadMemberId: '12', candidates: null, status: 'PENDING', reason: 'They agreed to book it', quote: QUOTE as string | null, confidence: 'high', decidedBy: null, ...over,
})

let rows: Array<ReturnType<typeof proposal>> = []
let callRow = call()

beforeEach(() => {
  vi.clearAllMocks()
  rows = [proposal()]
  callRow = call()
  vi.mocked(loadTaskProposalConfig).mockResolvedValue(ON)
  vi.mocked(loadPostFilter).mockResolvedValue(EMPTY_POST_FILTER)
  rec.findUnique.mockImplementation((async () => callRow) as never)
  prop.findUnique.mockImplementation((async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id) ?? null) as never)
  // The pass lists the call's pending ones; the summary lists applied + pending.
  prop.findMany.mockImplementation((async () => rows) as never)
  // A claim flips the row, like the database would.
  prop.updateMany.mockImplementation((async ({ where, data }: { where: { id?: string; status?: string }; data: Record<string, unknown> }) => {
    const r = rows.find((x) => x.id === where.id && (!where.status || x.status === where.status))
    if (!r) return { count: 0 }
    Object.assign(r, data)
    return { count: 1 }
  }) as never)
  task.findMany.mockResolvedValue([])
  task.create.mockResolvedValue({ id: 'new1' } as never)
  task.updateMany.mockResolvedValue({ count: 1 })
  vi.mocked(prisma.crewTaskEvent.create).mockResolvedValue({} as never)
  auto.findUnique.mockResolvedValue(null)
  auto.findMany.mockResolvedValue([])
  auto.upsert.mockResolvedValue({} as never)
  auto.createMany.mockResolvedValue({ count: 1 })
  auto.updateMany.mockResolvedValue({ count: 1 })
  vi.mocked(prisma.appSetting.findUnique).mockResolvedValue({ value: true, updatedAt: SINCE } as never)
  vi.mocked(prisma.appSettingChange.findMany).mockResolvedValue([])
})

const noSummary = { summary: async () => 'posted' as const }

describe('autoApplyForRecording', () => {
  it('off: applies nothing and marks nothing (unchanged behaviour)', async () => {
    vi.mocked(loadTaskProposalConfig).mockResolvedValue({ ...ON, autoApply: false })
    expect((await autoApplyForRecording('rec1')).result).toBe('disabled')
    expect(prop.findUnique).not.toHaveBeenCalled()
    expect(task.create).not.toHaveBeenCalled()
    expect(auto.upsert).not.toHaveBeenCalled()
  })

  it('a CREATE is added with the stage and lead from the call, as Metalhead, without asking a lead', async () => {
    const r = await autoApplyForRecording('rec1', noSummary)
    expect(r).toMatchObject({ result: 'ok', applied: 1, left: 0 })
    const data = (task.create.mock.calls[0][0] as { data: Record<string, unknown> }).data
    expect(data).toMatchObject({ crewId: 'ops', label: 'Book the venue', stage: 'doing', leadName: 'Ann', leadMemberId: '12', createdBy: AUTO_APPLY_ACTOR })
    expect(rows[0]).toMatchObject({ status: 'APPLIED', decidedBy: AUTO_APPLY_ACTOR })
    expect(canManageCrew).not.toHaveBeenCalled()
    expect(auto.upsert.mock.calls[0][0]).toMatchObject({ where: { recordingId: 'rec1' }, create: { appliedAt: expect.any(Date) } })
  })

  it('an unclear lead is applied with no lead rather than guessed or skipped', async () => {
    rows = [proposal({ changes: { label: { from: null, to: 'Print flyers' }, leadName: { from: null, to: 'Sam' } }, leadName: 'Sam', leadMemberId: null, candidates: [{ memberId: '13', name: 'Sam Roe' }, { memberId: '14', name: 'Sam Rowe' }] })]
    const r = await autoApplyForRecording('rec1', noSummary)
    expect(r).toMatchObject({ applied: 1, left: 0 })
    const data = (task.create.mock.calls[0][0] as { data: Record<string, unknown> }).data
    expect(data).toMatchObject({ label: 'Print flyers', leadName: null, leadMemberId: null })
    expect(rows[0].edited).toMatchObject({ skipLead: true })
  })

  it('a close is applied (confirmed) only when the model was sure and quoted the call; a retire never', async () => {
    const close = { kind: 'DONE', taskId: 't1', baseUpdatedAt: BASE, changes: { stage: { from: 'doing', to: 'done' } }, leadName: null, leadMemberId: null }
    const toClosed = { kind: 'UPDATE', taskId: 't1', baseUpdatedAt: BASE, changes: { stage: { from: 'doing', to: 'done' } }, leadName: null, leadMemberId: null }
    rows = [
      proposal({ id: 'd', ...close }),
      proposal({ id: 'dm', ...close, confidence: 'medium' }),
      proposal({ id: 'dq', ...close, quote: null }),
      proposal({ id: 'u', ...toClosed, confidence: 'medium' }),
      proposal({ id: 'uh', ...toClosed }),
      proposal({ id: 'up', kind: 'UPDATE', taskId: 't1', baseUpdatedAt: BASE, changes: { stage: { from: 'todo', to: 'doing' } }, confidence: 'medium', quote: null, leadName: null, leadMemberId: null }),
      proposal({ id: 'r', kind: 'RETIRE', taskId: 't2', baseUpdatedAt: BASE, changes: { archived: { from: false, to: true } }, leadName: null, leadMemberId: null }),
    ]
    task.findFirst.mockImplementation((async ({ where }: { where: { id: string } }) => ({ id: where.id, crewId: 'ops', label: 'X', stage: 'doing', priority: null, due: null, leadName: null, leadMemberId: null, archived: false, updatedAt: BASE })) as never)
    const r = await autoApplyForRecording('rec1', noSummary)
    expect(r).toMatchObject({ applied: 3, left: 4 })
    expect(Object.fromEntries(rows.map((x) => [x.id, x.status]))).toEqual({ d: 'APPLIED', dm: 'PENDING', dq: 'PENDING', u: 'PENDING', uh: 'APPLIED', up: 'APPLIED', r: 'PENDING' })
    // The ones left were never even tried.
    expect(prop.findUnique.mock.calls.map((c) => (c[0] as { where: { id: string } }).where.id)).toEqual(['d', 'uh', 'up'])
  })

  it('the pass is never stamped earlier than the call\'s newest action item', async () => {
    const later = new Date('2030-01-01T00:00:00Z')
    prop.findFirst.mockResolvedValue({ createdAt: later } as never)
    await autoApplyForRecording('rec1', { ...noSummary, now: () => new Date('2026-11-18T12:00:00Z') })
    expect(auto.upsert.mock.calls[0][0]).toMatchObject({ update: { appliedAt: later } })
  })

  it('a task edited since the call is a conflict: left pending, never forced', async () => {
    rows = [proposal({ kind: 'UPDATE', taskId: 't1', baseUpdatedAt: BASE, changes: { stage: { from: 'doing', to: 'review' } }, leadName: null, leadMemberId: null })]
    task.findFirst.mockResolvedValue({ id: 't1', crewId: 'ops', label: 'X', stage: 'doing', priority: null, due: null, leadName: null, archived: false, updatedAt: new Date('2026-11-02T00:00:00Z') } as never)
    const r = await autoApplyForRecording('rec1', noSummary)
    expect(r).toMatchObject({ result: 'ok', applied: 0, left: 1 })
    expect(rows[0].status).toBe('PENDING')
    expect(task.updateMany).not.toHaveBeenCalled()
    // The pass still counts as run, so the card sweep may now post this one's card.
    expect(auto.upsert).toHaveBeenCalled()
  })

  it('a held call is not touched until it is released', async () => {
    callRow = call({ reviewHoldAt: new Date() })
    expect((await autoApplyForRecording('rec1', noSummary)).result).toBe('held')
    expect(task.create).not.toHaveBeenCalled()
    expect(auto.upsert).not.toHaveBeenCalled()
    // Auto-held by an owner-only term too.
    callRow = call({ title: 'Sensitive plans' })
    vi.mocked(loadPostFilter).mockResolvedValue({ ...EMPTY_POST_FILTER, ownerOnlyTerms: ['sensitive'] })
    expect((await autoApplyForRecording('rec1', noSummary)).result).toBe('held')
    // Released: the next pass applies it.
    callRow = call()
    vi.mocked(loadPostFilter).mockResolvedValue(EMPTY_POST_FILTER)
    expect(await autoApplyForRecording('rec1', noSummary)).toMatchObject({ result: 'ok', applied: 1 })
  })

  it('an unreadable filter applies nothing (fail closed)', async () => {
    vi.mocked(loadPostFilter).mockRejectedValue(new Error('down'))
    expect((await autoApplyForRecording('rec1', noSummary)).result).toBe('failed')
    expect(task.create).not.toHaveBeenCalled()
  })

  it('an excluded crew or the allowlist still stop it (left pending)', async () => {
    vi.mocked(loadPostFilter).mockResolvedValue({ ...EMPTY_POST_FILTER, excludedCrewIds: ['ops'] })
    expect(await autoApplyForRecording('rec1', noSummary)).toMatchObject({ applied: 0, left: 1 })
    expect(task.create).not.toHaveBeenCalled()
  })

  it('a task routed to an owner-only crew is left pending (capos cannot see it)', async () => {
    rows = [proposal({ crewId: 'tech' })]
    vi.mocked(loadPostFilter).mockResolvedValue({ ...EMPTY_POST_FILTER, ownerOnlyCrewIds: ['tech'] })
    expect(await autoApplyForRecording('rec1', noSummary)).toMatchObject({ applied: 0, left: 1 })
    expect(prop.findUnique).not.toHaveBeenCalled()
  })

  it('only action items made since the switch was turned on', async () => {
    await autoApplyForRecording('rec1', noSummary)
    expect(prop.findMany.mock.calls[0][0]).toMatchObject({ where: { recordingId: 'rec1', status: 'PENDING', createdAt: { gte: SINCE } } })
  })

  it('posts the summary after the pass, only when something was applied or left', async () => {
    const summary = vi.fn(async () => 'posted' as const)
    await autoApplyForRecording('rec1', { summary })
    expect(summary).toHaveBeenCalledWith('rec1')
    summary.mockClear()
    rows = []
    await autoApplyForRecording('rec1', { summary })
    expect(summary).not.toHaveBeenCalled()
  })
})

describe('autoApplyDue (the cron sweep)', () => {
  const T = () => new Date('2026-11-18T12:00:00Z')
  it('the query leaves out calls whose pass covered their newest action item, newest first', async () => {
    const ranAt = new Date('2026-11-18T11:00:00Z')
    auto.findMany.mockResolvedValue([{ recordingId: 'rec2', appliedAt: ranAt }] as never)
    prop.findMany.mockImplementationOnce((async () => [{ recordingId: 'rec1' }]) as never)
    const r = await autoApplyDue(5, { ...noSummary, now: T, memo: new Map() })
    expect(r).toEqual({ ran: [{ id: 'rec1', result: 'ok', applied: 1 }], held: 0 })
    expect(prop.findMany.mock.calls[0][0]).toMatchObject({
      where: { status: 'PENDING', createdAt: { gte: SINCE }, OR: [{ recordingId: { notIn: ['rec2'] } }, { recordingId: 'rec2', createdAt: { gt: ranAt } }] },
      distinct: ['recordingId'],
      orderBy: { createdAt: 'desc' },
    })
  })

  it('held calls are skipped cheaply, cached per call version and filter, and never count toward the cap', async () => {
    const memo = new Map<string, string>()
    const v1 = new Date('2026-11-18T09:00:00Z')
    const calls: Record<string, Record<string, unknown>> = {
      manual: call({ id: 'manual', updatedAt: v1, reviewHoldAt: v1 }),
      owner: call({ id: 'owner', updatedAt: v1, crewId: 'secret' }),
      term: call({ id: 'term', updatedAt: v1, title: 'Sensitive plans' }),
      ok1: call({ id: 'ok1', updatedAt: v1 }),
    }
    rec.findUnique.mockImplementation((async ({ where }: { where: { id: string } }) => calls[where.id]) as never)
    vi.mocked(loadPostFilter).mockResolvedValue({ ...EMPTY_POST_FILTER, ownerOnlyTerms: ['sensitive'], ownerOnlyCrewIds: ['secret'] })
    const list = [{ recordingId: 'manual' }, { recordingId: 'owner' }, { recordingId: 'term' }, { recordingId: 'ok1' }]
    prop.findMany.mockImplementation((async (a: { distinct?: unknown }) => (a.distinct ? list : rows)) as never)
    let r = await autoApplyDue(1, { ...noSummary, now: T, memo })
    expect(r).toEqual({ ran: [{ id: 'ok1', result: 'ok', applied: 1 }], held: 3 })
    // Only the term-held one needed the full (transcript) read, and its result is cached.
    const fullReads = () => rec.findUnique.mock.calls.filter((c) => (c[0] as { select: Record<string, unknown> }).select.transcript).map((c) => (c[0] as { where: { id: string } }).where.id)
    expect(fullReads()).toEqual(['term', 'ok1'])
    rec.findUnique.mockClear()
    r = await autoApplyDue(1, { ...noSummary, now: T, memo })
    expect(fullReads()).not.toContain('term')
    // A new version of the call is checked again.
    calls.term = call({ id: 'term', updatedAt: new Date('2026-11-18T10:00:00Z') })
    rec.findUnique.mockClear()
    r = await autoApplyDue(5, { ...noSummary, now: T, memo })
    expect(fullReads()).toContain('term')
    expect((r as { ran: Array<{ id: string }> }).ran.map((x) => x.id)).toContain('term')
  })

  it('does nothing when off or switched on by env only', async () => {
    vi.mocked(loadTaskProposalConfig).mockResolvedValue({ ...ON, autoApply: false })
    expect(await autoApplyDue()).toEqual({ skipped: 'disabled' })
    vi.mocked(loadTaskProposalConfig).mockResolvedValue(ON)
    vi.mocked(prisma.appSetting.findUnique).mockResolvedValue(null)
    expect(await autoApplyDue()).toEqual({ skipped: 'no switch-on time' })
  })
})

describe('undo of an auto-applied retire', () => {
  it('a crew lead can undo it like any applied retire', async () => {
    vi.mocked(canManageCrew).mockResolvedValue(true)
    prop.findUnique.mockResolvedValue({ crewId: 'ops', kind: 'RETIRE', status: 'APPLIED', taskId: 't2', decidedBy: AUTO_APPLY_ACTOR } as never)
    task.updateMany.mockResolvedValue({ count: 1 })
    prop.updateMany.mockResolvedValue({ count: 1 } as never)
    expect(await undoRetire('r', 'lead1')).toBe('undone')
    expect(prop.updateMany.mock.calls[0][0]).toMatchObject({ data: { status: 'UNDONE', decidedBy: 'lead1' } })
  })
})

// ------------------------------------------------------------- summary ---

const item = (label: string, over: Partial<SummaryItem> = {}): SummaryItem => ({ label, stage: 'doing', lead: 'Ann', crewId: 'ops', crewLabel: 'Ops', ...over })

describe('renderActionItemSummary', () => {
  it('lists added, updated, closed and what needs a look, with stage, lead and the crew page link', () => {
    const text = renderActionItemSummary(
      { callTitle: 'Weekly sync', callStartedAt: null, added: [item('Book the venue'), item('Print flyers', { lead: null })], updated: [item('Order stickers', { stage: 'review' })], closed: [item('Fix the bot', { stage: 'done' })], needsLook: 1, moreUrl: `${APP}/crew/ops`, cardsEnabled: true },
      APP,
    )
    expect(text).toContain('Added from **Weekly sync**: 2 tasks')
    expect(text).toContain('• **Book the venue** · doing · Ann · [Ops](<https://app.example.test/crew/ops>)')
    expect(text).toContain('**Print flyers** · doing · no lead')
    expect(text).toContain('Updated: 1 task\n• **Order stickers** · review')
    expect(text).toContain('Closed: 1 task\n• **Fix the bot** · done')
    expect(text).toContain('Needs a look: 1 task (each has its own card)')
  })

  it('leads with the first section that has something (never "Added: 0 tasks"); the card note only when cards are on', () => {
    const base = { callTitle: 'Weekly sync', callStartedAt: null, added: [], updated: [], closed: [], needsLook: 0, moreUrl: APP }
    const upd = renderActionItemSummary({ ...base, updated: [item('Order stickers')], needsLook: 2 }, APP)
    expect(upd.startsWith('📋 Updated from **Weekly sync**: 1 task\n• **Order stickers**')).toBe(true)
    expect(upd).not.toContain('Added')
    expect(upd).toContain('Needs a look: 2 tasks')
    expect(upd).not.toContain('own card')
    const closed = renderActionItemSummary({ ...base, closed: [item('Fix the bot', { stage: 'done' })] }, APP)
    expect(closed.startsWith('📋 Closed from **Weekly sync**: 1 task')).toBe(true)
    const look = renderActionItemSummary({ ...base, needsLook: 1, cardsEnabled: true }, APP)
    expect(look).toBe('📋 Needs a look from **Weekly sync**: 1 task (each has its own card)')
  })

  it('stays within the Discord limit, cut with "and N more" and a link', () => {
    const added = Array.from({ length: 80 }, (_, i) => item(`A rather long task label number ${i} ${'x'.repeat(60)}`))
    const text = renderActionItemSummary({ callTitle: 'Weekly sync', callStartedAt: null, added, updated: [], closed: [], needsLook: 3, moreUrl: `${APP}/crew/ops` }, APP)
    expect(text.length).toBeLessThanOrEqual(SUMMARY_MAX)
    expect(text).toMatch(/…and \d+ more: <https:\/\/app\.example\.test\/crew\/ops>/)
    expect(text).toContain('Needs a look: 3 tasks')
  })

  it('neutralizes mentions and markdown in labels', () => {
    const text = renderActionItemSummary({ callTitle: '@everyone call', callStartedAt: null, added: [item('Ping <@123> **now**')], updated: [], closed: [], needsLook: 0, moreUrl: APP }, APP)
    expect(text).not.toContain('@everyone')
    expect(text).not.toContain('<@123>')
  })
})

describe('postActionItemSummary', () => {
  const posts: Array<{ channelId: string; msg: { content: string; allowed_mentions: unknown } }> = []
  const deps = (over: Record<string, unknown> = {}) => ({
    env: { DISCORD_BOT_TOKEN: 'tok' },
    cardsEnabled: async () => true,
    channelId: async () => '111',
    channelIsPrivate: async () => true,
    appUrl: () => APP,
    post: async (channelId: string, msg: { content: string; allowed_mentions: { parse: never[] }; flags: number }) => {
      posts.push({ channelId, msg })
      return { id: 'm1' }
    },
    ...over,
  })
  beforeEach(() => {
    posts.length = 0
    rows = [
      proposal({ status: 'APPLIED', decidedBy: AUTO_APPLY_ACTOR }),
      proposal({ id: 'p2', kind: 'UPDATE', taskId: 't1', changes: { stage: { from: 'doing', to: 'review' } }, status: 'PENDING' }),
    ]
  })

  it('posts once, claimed first, with no transcript quote and no pings', async () => {
    expect(await postActionItemSummary('rec1', deps())).toBe('posted')
    expect(posts).toHaveLength(1)
    expect(posts[0].channelId).toBe('111')
    expect(posts[0].msg.allowed_mentions).toEqual({ parse: [] })
    expect(posts[0].msg.content).toMatch(/^📋 Added from \*\*Weekly sync\*\* \(.+\): 1 task\n• \*\*Book the venue\*\* · doing · Ann · \[Ops\]/)
    expect(posts[0].msg.content).toContain('Needs a look: 1 task')
    expect(posts[0].msg.content).not.toContain(QUOTE)
    expect(posts[0].msg.content).not.toContain('They agreed')
    expect(auto.updateMany.mock.calls[0][0]).toMatchObject({ where: { recordingId: 'rec1', summaryClaimedAt: null } })
    expect(auto.updateMany.mock.invocationCallOrder[0]).toBeLessThan(auto.updateMany.mock.invocationCallOrder[1])
    // Already claimed (by this run or a parallel one): never a second post.
    auto.findUnique.mockResolvedValue({ summaryClaimedAt: new Date() } as never)
    expect(await postActionItemSummary('rec1', deps())).toBe('already')
    auto.findUnique.mockResolvedValue(null)
    auto.updateMany.mockResolvedValueOnce({ count: 0 })
    expect(await postActionItemSummary('rec1', deps())).toBe('already')
    expect(posts).toHaveLength(1)
  })

  it('"Needs a look" counts only what the pass considered (made since the switch); no card note when cards are off', async () => {
    await postActionItemSummary('rec1', deps({ cardsEnabled: async () => false }))
    expect(prop.findMany.mock.calls[0][0]).toMatchObject({ where: { recordingId: 'rec1', OR: [{ status: 'APPLIED', decidedBy: AUTO_APPLY_ACTOR }, { status: 'PENDING', createdAt: { gte: SINCE } }] } })
    expect(posts[0].msg.content).toContain('Needs a look: 1 task')
    expect(posts[0].msg.content).not.toContain('own card')
  })

  it('never posts to a channel that is not private', async () => {
    expect(await postActionItemSummary('rec1', deps({ channelIsPrivate: async () => false }))).toBe('channel-not-private')
    expect(posts).toHaveLength(0)
    expect(auto.updateMany).not.toHaveBeenCalled() // nothing claimed
  })

  it('posts nothing when off, without a token or channel, for a held call, or when nothing is there', async () => {
    vi.mocked(loadTaskProposalConfig).mockResolvedValue({ ...ON, autoApply: false })
    expect(await postActionItemSummary('rec1', deps())).toBe('disabled')
    vi.mocked(loadTaskProposalConfig).mockResolvedValue(ON)
    expect(await postActionItemSummary('rec1', deps({ env: {} }))).toBe('no-token')
    expect(await postActionItemSummary('rec1', deps({ channelId: async () => '' }))).toBe('no-channel')
    callRow = call({ reviewHoldAt: new Date() })
    expect(await postActionItemSummary('rec1', deps())).toBe('hidden')
    callRow = call()
    rows = []
    expect(await postActionItemSummary('rec1', deps())).toBe('none')
    expect(posts).toHaveLength(0)
  })

  it('a definite Discord refusal releases the claim; anything else keeps it (Discord may hold the message)', async () => {
    expect(await postActionItemSummary('rec1', deps({ post: async () => Promise.reject(new DiscordPostError('nope', 403)) }))).toBe('failed')
    expect(auto.updateMany.mock.calls.at(-1)?.[0]).toMatchObject({ data: { summaryClaimedAt: null } })
    auto.updateMany.mockClear()
    expect(await postActionItemSummary('rec1', deps({ post: async () => Promise.reject(new Error('timeout')) }))).toBe('failed')
    expect((auto.updateMany.mock.calls.at(-1)?.[0] as { data: Record<string, unknown> }).data).not.toHaveProperty('summaryClaimedAt')
  })
})
