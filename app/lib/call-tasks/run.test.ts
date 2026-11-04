// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/lib/db')
vi.mock('@/app/lib/sheets-import/source', () => ({ usesDb: vi.fn() }))
vi.mock('@/app/lib/followups/draft', () => ({ loadMembers: vi.fn(async () => []) }))
vi.mock('@/app/lib/calls/post-filters', async (orig) => ({ ...(await orig<typeof import('@/app/lib/calls/post-filters')>()), loadPostFilter: vi.fn() }))
vi.mock('@/app/lib/calls/recap', () => ({ redactionsNewerThanSummary: vi.fn(() => false), resolveRecapChannel: vi.fn(async () => ({ channelId: '555', label: '#crew' })) }))
vi.mock('./extract', () => ({ proposeTaskUpdates: vi.fn(async () => []) }))
vi.mock('./config', async (orig) => ({ ...(await orig<typeof import('./config')>()), loadTaskProposalConfig: vi.fn() }))
vi.mock('@/app/lib/settings', () => ({ loadSettings: vi.fn(async () => ({ readFailed: false, invalidKeys: [], isSet: () => false, get: () => '' })) }))

import { prisma } from '@/app/lib/db'
import { usesDb } from '@/app/lib/sheets-import/source'
import { EMPTY_POST_FILTER, loadPostFilter } from '@/app/lib/calls/post-filters'
import { redactionsNewerThanSummary } from '@/app/lib/calls/recap'
import { proposeTaskUpdates } from './extract'
import { loadTaskProposalConfig, taskProposalConfigFrom, type TaskProposalConfig } from './config'
import { SETTINGS, type SettingKey } from '@/app/lib/settings/registry'
import type { Settings } from '@/app/lib/settings'
import { expireOldProposals, listNeedingProposals, nudgeCrew, nudgeText, proposeTasksForRecording, storeProposals } from './run'
import type { ProposalDraft } from './proposals'

const rec = vi.mocked(prisma.callRecording)
const prop = vi.mocked(prisma.crewTaskProposal)
const cfgMock = vi.mocked(loadTaskProposalConfig)
const propose = vi.mocked(proposeTaskUpdates)

const ON: TaskProposalConfig = { enabled: true, crews: ['ops'], maxPerCall: 15, maxDays: 14, model: '', nudge: false }
const seg = (discordId: string, startMs: number, text: string, extra: Record<string, unknown> = {}) => ({ discordId, startMs, endMs: startMs + 1000, text, ...extra })
const recording = (over: Record<string, unknown> = {}) => ({
  id: 'rec1', sessionId: 'sess-1', status: 'PUBLISHED', source: 'DISCORD', crewId: 'ops', crewLabel: 'Ops', summary: 'A summary',
  actionItems: [{ text: 'Order stickers', owner: 'Ann' }], redactedSpeakerIds: [], redactedSegmentIds: [], redactionsUpdatedAt: null, summaryGeneratedAt: null, summaryEditedAt: null,
  taskProposalsAt: null, taskProposalsAttempts: 0,
  transcript: [seg('900', 1000, 'hello team'), seg('901', 5000, 'private words')],
  speakers: [{ discordId: '900', displayName: 'Ann' }, { discordId: '901', displayName: 'Bob' }],
  ...over,
})
const draft = (over: Partial<ProposalDraft> = {}): ProposalDraft => ({
  sourceKey: 'rec1:DONE:t1', kind: 'DONE', taskId: 't1', baseUpdatedAt: new Date('2026-11-01T00:00:00Z'), changes: { stage: { from: 'doing', to: 'done' } },
  leadName: null, leadMemberId: null, candidates: [], reason: 'It was finished', quote: null, startMs: null, confidence: 'high', actionItemIdx: null, ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  cfgMock.mockResolvedValue(ON)
  vi.mocked(usesDb).mockResolvedValue(true)
  vi.mocked(loadPostFilter).mockResolvedValue(EMPTY_POST_FILTER)
  vi.mocked(redactionsNewerThanSummary).mockReturnValue(false)
  rec.findUnique.mockResolvedValue(recording() as never)
  rec.updateMany.mockResolvedValue({ count: 1 })
  rec.update.mockResolvedValue({} as never)
  vi.mocked(prisma.callLiveItem.findMany).mockResolvedValue([])
  vi.mocked(prisma.crewTask.findMany).mockResolvedValue([])
  prop.findMany.mockResolvedValue([])
  prop.create.mockResolvedValue({} as never)
  prop.updateMany.mockResolvedValue({ count: 0 })
  propose.mockResolvedValue([])
})

describe('config', () => {
  const fake = (over: Partial<Record<SettingKey, unknown>> = {}, readFailed = false): Settings => ({
    readFailed, invalidKeys: [], isSet: (k) => k in over, get: ((k: SettingKey) => (k in over ? over[k] : SETTINGS[k].default)) as Settings['get'],
  })
  const prod = { VERCEL_ENV: 'production' }
  it('is off by default, and the switch alone does nothing without a crew list', () => {
    expect(taskProposalConfigFrom(fake(), prod).enabled).toBe(false)
    expect(taskProposalConfigFrom(fake({ 'calls.taskProposalsEnabled': true }), prod).enabled).toBe(false)
    expect(taskProposalConfigFrom(fake({ 'calls.taskProposalsCrews': 'ops' }), prod).enabled).toBe(false)
    expect(taskProposalConfigFrom(fake({ 'calls.taskProposalsEnabled': true, 'calls.taskProposalsCrews': 'Ops, Tech Team' }), prod)).toMatchObject({ enabled: true, crews: ['ops', 'tech_team'] })
  })
  it('is off when settings cannot be read, on previews, and with the env kill switch', () => {
    const on = { 'calls.taskProposalsEnabled': true, 'calls.taskProposalsCrews': 'ops' }
    expect(taskProposalConfigFrom(fake(on, true), prod).enabled).toBe(false)
    expect(taskProposalConfigFrom(fake(on), { VERCEL_ENV: 'preview' }).enabled).toBe(false)
    expect(taskProposalConfigFrom(fake(on), { ...prod, CALL_TASK_PROPOSALS_ENABLED: 'off' }).enabled).toBe(false)
  })
  it('the nudge is a separate switch, off by default', () => {
    expect(taskProposalConfigFrom(fake({ 'calls.taskProposalsEnabled': true, 'calls.taskProposalsCrews': 'ops' }), prod).nudge).toBe(false)
    expect(taskProposalConfigFrom(fake({ 'calls.taskProposalsNudgeEnabled': true }), prod).nudge).toBe(true)
  })
})

describe('proposeTasksForRecording gating', () => {
  it('does nothing when switched off or the crew is not allowlisted, and marks nothing', async () => {
    cfgMock.mockResolvedValue({ ...ON, enabled: false })
    expect((await proposeTasksForRecording('rec1')).result).toBe('disabled')
    cfgMock.mockResolvedValue({ ...ON, crews: ['tech'] })
    expect((await proposeTasksForRecording('rec1')).result).toBe('disabled')
    expect(propose).not.toHaveBeenCalled()
    expect(rec.update).not.toHaveBeenCalled()
    expect(rec.updateMany).not.toHaveBeenCalled()
  })
  it('skips calls that are not ready, have no crew, are imported, or are already done', async () => {
    rec.findUnique.mockResolvedValue(recording({ status: 'RECORDED' }) as never)
    expect((await proposeTasksForRecording('rec1')).result).toBe('not-ready')
    rec.findUnique.mockResolvedValue(recording({ summary: null }) as never)
    expect((await proposeTasksForRecording('rec1')).result).toBe('not-ready')
    rec.findUnique.mockResolvedValue(recording({ crewId: null }) as never)
    expect((await proposeTasksForRecording('rec1')).result).toBe('disabled')
    rec.findUnique.mockResolvedValue(recording({ source: 'X_BROADCAST' }) as never)
    expect((await proposeTasksForRecording('rec1')).result).toBe('disabled')
    rec.findUnique.mockResolvedValue(recording({ taskProposalsAt: new Date() }) as never)
    expect((await proposeTasksForRecording('rec1')).result).toBe('already')
    rec.findUnique.mockResolvedValue(null)
    expect((await proposeTasksForRecording('rec1')).result).toBe('not-found')
    expect(propose).not.toHaveBeenCalled()
  })
  it('sheet-backed crews and excluded crews are marked handled and never reach the model', async () => {
    vi.mocked(usesDb).mockResolvedValue(false)
    expect((await proposeTasksForRecording('rec1')).result).toBe('not-db-crew')
    vi.mocked(usesDb).mockResolvedValue(true)
    vi.mocked(loadPostFilter).mockResolvedValue({ ...EMPTY_POST_FILTER, excludedCrewIds: ['ops'] })
    expect((await proposeTasksForRecording('rec1')).result).toBe('crew-excluded')
    expect(rec.updateMany).toHaveBeenCalledTimes(2)
    expect(propose).not.toHaveBeenCalled()
  })
  it('an unreadable private filter proposes nothing', async () => {
    vi.mocked(loadPostFilter).mockRejectedValue(new Error('down'))
    expect((await proposeTasksForRecording('rec1')).result).toBe('failed')
    expect(propose).not.toHaveBeenCalled()
  })
  it('gives up after three attempts', async () => {
    rec.findUnique.mockResolvedValue(recording({ taskProposalsAttempts: 3 }) as never)
    expect((await proposeTasksForRecording('rec1')).result).toBe('failed')
    expect(propose).not.toHaveBeenCalled()
  })
})

describe('proposeTasksForRecording run', () => {
  it('claims an attempt first, stores new proposals and marks the call done', async () => {
    propose.mockResolvedValue([draft()])
    const r = await proposeTasksForRecording('rec1')
    expect(r).toEqual({ result: 'ok', created: 1 })
    expect(rec.updateMany.mock.calls[0][0]).toMatchObject({ data: { taskProposalsAttempts: { increment: 1 } } })
    expect(prop.create.mock.calls[0][0]).toMatchObject({ data: { recordingId: 'rec1', crewId: 'ops', kind: 'DONE', taskId: 't1' } })
    expect(rec.update.mock.calls[0][0]).toMatchObject({ data: { taskProposalsError: null } })
  })

  it('hidden speakers and hidden lines never reach the model', async () => {
    rec.findUnique.mockResolvedValue(
      recording({
        redactedSpeakerIds: ['901'],
        redactedSegmentIds: ['s:900:1000'],
        transcript: [seg('900', 1000, 'hidden line'), seg('900', 2000, 'visible line'), seg('901', 5000, 'private words')],
      }) as never,
    )
    await proposeTasksForRecording('rec1')
    const input = propose.mock.calls[0][0]
    expect(input.segments.map((s) => s.text)).toEqual(['visible line'])
    expect(input.speakers.map((s) => s.discordId)).toEqual(['900'])
  })

  it('merges live action items with redactions applied; summary items are dropped when redactions are newer', async () => {
    vi.mocked(prisma.callLiveItem.findMany).mockResolvedValue([
      { text: 'Book the venue', owner: 'Ann', source: 'chat', speakerIds: ['900'], messageId: '7', startMs: 1, endMs: null },
      { text: 'Hidden speaker item', owner: null, source: 'chat', speakerIds: ['901'], messageId: '8', startMs: 1, endMs: null },
    ] as never)
    rec.findUnique.mockResolvedValue(
      recording({ redactedSpeakerIds: ['901'], transcript: [seg('900', 1000, 'action: book the venue', { kind: 'chat', id: 'c:7' }), seg('901', 2000, 'x', { kind: 'chat', id: 'c:8' })] }) as never,
    )
    await proposeTasksForRecording('rec1')
    expect(propose.mock.calls[0][0].actionItems.map((a) => a.text)).toEqual(['Order stickers', 'Book the venue'])

    vi.mocked(redactionsNewerThanSummary).mockReturnValue(true)
    await proposeTasksForRecording('rec1', { force: true })
    expect(propose.mock.calls[1][0].actionItems.map((a) => a.text)).toEqual(['Book the venue'])
  })

  it('a model failure is recorded (sanitized) and leaves the call for the sweep to retry', async () => {
    propose.mockRejectedValue(new Error('boom https://secret.example/x'))
    const r = await proposeTasksForRecording('rec1')
    expect(r.result).toBe('failed')
    const data = (rec.update.mock.calls[0][0] as { data: { taskProposalsError: string } }).data
    expect(data.taskProposalsError).toContain('boom')
    expect(data.taskProposalsError).not.toContain('https')
  })

  it('force re-runs without claiming an attempt', async () => {
    rec.findUnique.mockResolvedValue(recording({ taskProposalsAt: new Date() }) as never)
    const r = await proposeTasksForRecording('rec1', { force: true })
    expect(r.result).toBe('ok')
    expect(rec.updateMany).not.toHaveBeenCalled()
  })

  it('posts the nudge only when its switch is on and something was created', async () => {
    propose.mockResolvedValue([draft()])
    vi.mocked(prisma.crewTaskProposal.count).mockResolvedValue(1)
    await proposeTasksForRecording('rec1')
    expect(rec.findUnique).toHaveBeenCalledTimes(1) // no nudge lookup
  })
})

describe('storeProposals', () => {
  it('skips existing source keys and marks older pending proposals for the same task stale', async () => {
    prop.findMany.mockResolvedValue([{ sourceKey: 'rec1:DONE:t1' }] as never)
    const n = await storeProposals('rec1', 'ops', [draft(), draft({ sourceKey: 'rec1:UPDATE:t2', kind: 'UPDATE', taskId: 't2' })])
    expect(n).toBe(1)
    expect(prop.create).toHaveBeenCalledTimes(1)
    expect(prop.updateMany).not.toHaveBeenCalled() // no start time given: nothing is staled
  })
  it('only proposals from OLDER calls of the crew go stale', async () => {
    const started = new Date('2026-11-02T17:00:00Z')
    rec.findMany.mockResolvedValue([{ id: 'older1' }] as never)
    await storeProposals('rec1', 'ops', [draft()], started)
    expect(rec.findMany.mock.calls[0][0]).toMatchObject({ where: { crewId: 'ops', startedAt: { lt: started }, id: { not: 'rec1' } } })
    expect(prop.updateMany.mock.calls[0][0]).toMatchObject({ where: { taskId: 't1', status: 'PENDING', recordingId: { in: ['older1'] } } })
    prop.updateMany.mockClear()
    rec.findMany.mockResolvedValue([] as never)
    await storeProposals('rec1', 'ops', [draft({ sourceKey: 'rec1:DONE:t9' })], started) // no older calls: nothing to stale
    expect(prop.updateMany).not.toHaveBeenCalled()
  })
  it('a parallel run creating the same key is the idempotency guard, not an error', async () => {
    prop.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }))
    expect(await storeProposals('rec1', 'ops', [draft()])).toBe(0)
  })
})

describe('sweep', () => {
  it('lists nothing when off, otherwise only allowlisted crews', async () => {
    cfgMock.mockResolvedValue({ ...ON, enabled: false })
    expect(await listNeedingProposals()).toEqual([])
    cfgMock.mockResolvedValue(ON)
    rec.findMany.mockResolvedValue([{ id: 'rec1' }] as never)
    expect(await listNeedingProposals(1)).toEqual([{ id: 'rec1' }])
    expect(rec.findMany.mock.calls[0][0]).toMatchObject({ where: { crewId: { in: ['ops'] }, taskProposalsAt: null, source: 'DISCORD' } })
  })
  it('expires old undecided proposals', async () => {
    prop.updateMany.mockResolvedValue({ count: 3 })
    expect(await expireOldProposals(14, new Date('2026-11-20T00:00:00Z'))).toBe(3)
    expect(prop.updateMany.mock.calls[0][0]).toMatchObject({ where: { status: 'PENDING' }, data: { status: 'STALE' } })
  })
})

describe('nudgeCrew', () => {
  const env = { DISCORD_BOT_TOKEN: 'tok' }
  const post = vi.fn(async () => ({ id: 'm1' }))
  beforeEach(() => {
    post.mockClear()
    rec.findUnique.mockResolvedValue({ id: 'rec1', crewId: 'ops', crewLabel: 'Ops', taskProposalsNudgedAt: null } as never)
    vi.mocked(prisma.crewTaskProposal.count).mockResolvedValue(2)
  })
  it('is off by default', async () => {
    expect(await nudgeCrew('rec1', { env, post: post as never })).toBe('disabled')
    expect(post).not.toHaveBeenCalled()
  })
  it('posts a count and a link, once, claim first', async () => {
    cfgMock.mockResolvedValue({ ...ON, nudge: true })
    expect(await nudgeCrew('rec1', { env, post: post as never })).toBe('posted')
    const [target, body] = post.mock.calls[0] as unknown as [{ channelId: string }, { content: string; allowed_mentions: unknown }]
    expect(target.channelId).toBe('555')
    expect(body.content).toBe(nudgeText(2, 'ops'))
    expect(body.content).toContain('/crew/ops#call-updates')
    expect(body.allowed_mentions).toEqual({ parse: [] })
    expect(rec.updateMany.mock.invocationCallOrder[0]).toBeLessThan(post.mock.invocationCallOrder[0])
    rec.findUnique.mockResolvedValue({ id: 'rec1', crewId: 'ops', crewLabel: 'Ops', taskProposalsNudgedAt: new Date() } as never)
    expect(await nudgeCrew('rec1', { env, post: post as never })).toBe('already')
  })
  it('never posts for an excluded crew, without proposals, or without a token', async () => {
    cfgMock.mockResolvedValue({ ...ON, nudge: true })
    vi.mocked(loadPostFilter).mockResolvedValue({ ...EMPTY_POST_FILTER, excludedCrewIds: ['ops'] })
    expect(await nudgeCrew('rec1', { env, post: post as never })).toBe('excluded')
    vi.mocked(loadPostFilter).mockResolvedValue(EMPTY_POST_FILTER)
    vi.mocked(prisma.crewTaskProposal.count).mockResolvedValue(0)
    expect(await nudgeCrew('rec1', { env, post: post as never })).toBe('none')
    expect(await nudgeCrew('rec1', { env: {}, post: post as never })).toBe('no-token')
    expect(post).not.toHaveBeenCalled()
  })
})
