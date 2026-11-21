// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/lib/db')
vi.mock('next/server', () => ({ after: (fn: () => unknown) => void fn() }))
vi.mock('@/app/lib/settings/toggles', async (orig) => ({ ...(await orig<typeof import('@/app/lib/settings/toggles')>()), toggleEnabled: vi.fn(async () => true) }))
vi.mock('@/app/lib/calls/post-filters', async (orig) => ({ ...(await orig<typeof import('@/app/lib/calls/post-filters')>()), loadPostFilter: vi.fn() }))
vi.mock('@/app/lib/crew-mappings', async (orig) => ({
  ...(await orig<typeof import('@/app/lib/crew-mappings')>()),
  getCrewMappings: vi.fn(async () => ({ cached: true, crews: [{ id: 'ops', label: 'Ops', type: 'crew', turtles: [] }] })),
}))

import { prisma } from '@/app/lib/db'
import { EMPTY_POST_FILTER, loadPostFilter } from '@/app/lib/calls/post-filters'
import { DiscordPostError } from '@/app/lib/discord-rest'
import { renderHash } from '@/app/lib/calls/review-cards'
import {
  loadProposalCardView,
  proposalCardState,
  renderProposalCard,
  syncDueTaskProposalCards,
  syncTaskProposalCard,
  type ProposalCardView,
  type ProposalSweepDeps,
} from './cards'

const NOW = new Date('2026-11-18T12:00:00Z')
const APP = 'https://app.example.test'
const QUOTE = 'the secret transcript sentence'

function view(o: Partial<ProposalCardView> = {}): ProposalCardView {
  return {
    id: 'prop00000001',
    recordingId: 'rec1',
    crewId: 'ops',
    crewLabel: 'Ops',
    callTitle: 'Weekly sync',
    callStartedAt: new Date('2026-11-17T18:00:00Z'),
    kind: 'UPDATE',
    status: 'PENDING',
    taskLabel: 'Order stickers',
    changes: [{ field: 'stage', from: 'doing', to: 'review' }],
    lead: null,
    leadCandidates: [],
    reason: 'They said the stickers are being reviewed.',
    needsInput: null,
    taskChanged: false,
    taskGone: false,
    hidden: false,
    interactive: true,
    decidedBy: null,
    decidedAt: null,
    error: null,
    createdAt: new Date('2026-11-18T10:00:00Z'),
    card: null,
    ...o,
  }
}

type Msg = ReturnType<typeof renderProposalCard>
const text = (m: Msg) => m.embeds.map((e) => e.description ?? '').join('\n')
const buttons = (m: Msg) => (m.components[0] as { components: Array<{ label: string; custom_id?: string; url?: string }> }).components

function makeDeps(initial: ProposalCardView, over: Partial<ProposalSweepDeps> = {}) {
  const state = { v: initial, claimed: false, posts: [] as Msg[], edits: [] as Msg[], saved: [] as unknown[] }
  const deps: ProposalSweepDeps = {
    enabled: () => true,
    load: async () => ({ ...state.v, card: state.v.card ? { ...state.v.card } : null }),
    maxAgeDays: async () => 14,
    channelId: async () => '111111111111111111',
    channelIsPrivate: async () => true,
    claim: async () => {
      if (state.claimed || state.v.card?.messageId) return false
      state.claimed = true
      return true
    },
    unclaim: async () => void (state.claimed = false),
    store: async (_id, c) => void (state.v.card = { ...c, resolvedAt: null, claimedAt: NOW }),
    saveState: async (_id, s) => {
      state.saved.push(s)
      state.v.card = { channelId: null, messageId: null, renderedHash: null, claimedAt: null, ...(state.v.card ?? {}), resolvedAt: s.resolvedAt, ...(s.renderedHash ? { renderedHash: s.renderedHash } : {}) }
    },
    clearMessage: async () => void (state.v.card = null),
    post: async (_c, m) => {
      state.posts.push(m)
      return { id: '222222222222222222' }
    },
    edit: async (_c, m) => void state.edits.push(m),
    appUrl: () => APP,
    now: () => NOW,
    since: async () => new Date('2026-11-18T00:00:00Z'),
    listNew: async () => [],
    listExisting: async () => [],
    ...over,
  }
  return { state, deps }
}

describe('renderProposalCard', () => {
  it('open: crew, call, change from -> to, reason; Apply / Dismiss / Edit on website; no pings', () => {
    const m = renderProposalCard(view(), { appUrl: APP })
    const t = text(m)
    expect(t).toContain('Task update: Ops')
    expect(t).toContain('Order stickers')
    expect(t).toContain('Weekly sync')
    expect(t).toContain('Stage: doing → review')
    expect(t).toContain('Why: They said')
    expect(buttons(m).map((b) => b.label)).toEqual(['Apply', 'Dismiss', 'Edit on website'])
    expect(buttons(m)[0].custom_id).toBe('tp:apply:prop00000001')
    expect(buttons(m)[1].custom_id).toBe('tp:dismiss:prop00000001')
    expect(buttons(m)[2].url).toBe(`${APP}/crew/ops#call-updates`)
    expect(m.allowed_mentions).toEqual({ parse: [] })
  })

  it('never carries the transcript quote (the view has none, and the loader never selects it)', async () => {
    vi.mocked(loadPostFilter).mockResolvedValue(EMPTY_POST_FILTER)
    vi.mocked(prisma.crewTaskProposal.findUnique).mockResolvedValue({
      id: 'p1', recordingId: 'rec1', crewId: 'ops', kind: 'UPDATE', taskId: 't1', baseUpdatedAt: NOW, changes: { stage: { from: 'doing', to: 'review' } }, edited: null,
      leadName: null, leadMemberId: null, candidates: null, reason: 'why', status: 'PENDING', decidedBy: null, decidedAt: null, error: null, createdAt: NOW, card: null, quote: QUOTE,
    } as never)
    vi.mocked(prisma.callRecording.findUnique).mockResolvedValue({ id: 'rec1', updatedAt: NOW, crewId: 'ops', crewLabel: 'Ops', title: 'Weekly', eventName: null, startedAt: NOW, source: 'DISCORD', status: 'PUBLISHED', transcript: [] } as never)
    vi.mocked(prisma.crewTask.findUnique).mockResolvedValue({ label: 'Order stickers', updatedAt: NOW, archived: false } as never)
    const v = await loadProposalCardView('p1')
    const select = vi.mocked(prisma.crewTaskProposal.findUnique).mock.calls[0][0].select as Record<string, unknown>
    expect(select.quote).toBeUndefined()
    expect(select.startMs).toBeUndefined()
    expect(JSON.stringify(renderProposalCard(v!, { appUrl: APP }))).not.toContain(QUOTE)
  })

  it('ambiguous lead: "unclear: A / B", no Apply, Dismiss and Choose on website', () => {
    const m = renderProposalCard(view({ leadCandidates: ['Alex A', 'Alex B'], needsInput: 'lead', lead: { from: null, to: 'Alex' } }), { appUrl: APP })
    expect(text(m)).toContain('Lead: unclear: Alex A / Alex B')
    expect(buttons(m).map((b) => b.label)).toEqual(['Dismiss', 'Choose on website'])
  })

  it('a resolved lead shows from -> to', () => {
    expect(text(renderProposalCard(view({ lead: { from: 'Sam', to: 'Kim' } }), { appUrl: APP }))).toContain('Lead: Sam → Kim')
  })

  it('task changed since proposed: a stale line, no Apply', () => {
    const m = renderProposalCard(view({ taskChanged: true }), { appUrl: APP })
    expect(text(m)).toContain('Stale: the task changed since')
    expect(buttons(m).map((b) => b.label)).toEqual(['Dismiss', 'Review on website'])
  })

  it('decided: who decided, buttons removed (only the link)', () => {
    const applied = renderProposalCard(view({ status: 'APPLIED', decidedBy: '333333333333333333', decidedAt: NOW }), { appUrl: APP })
    expect(text(applied)).toContain('Applied by <@333333333333333333>')
    expect(buttons(applied).map((b) => b.label)).toEqual(['Open on website'])
    expect(text(renderProposalCard(view({ status: 'DISMISSED', decidedBy: '333333333333333333' }), { appUrl: APP }))).toContain('Dismissed by <@333333333333333333>')
    expect(text(renderProposalCard(view({ status: 'STALE', error: 'The task no longer exists' }), { appUrl: APP }))).toContain('Stale: The task no longer exists')
  })

  it('not interactive (capo review off): only the link', () => {
    expect(buttons(renderProposalCard(view({ interactive: false }), { appUrl: APP })).map((b) => b.label)).toEqual(['Edit on website'])
  })

  it('hidden: no task, no reason, only the link, whatever the status', () => {
    for (const status of ['PENDING', 'APPLIED']) {
      const m = renderProposalCard(view({ hidden: true, status }), { appUrl: APP })
      expect(text(m)).not.toContain('Order stickers')
      expect(text(m)).not.toContain('They said')
      expect(buttons(m).map((b) => b.label)).toEqual(['Open on website'])
    }
  })

  it('a proposal left on a non-crew call links to the admin call page', () => {
    expect(buttons(renderProposalCard(view({ crewId: 'community_call' }), { appUrl: APP }))[2].url).toBe(`${APP}/admin/calls/rec1#call-updates`)
  })

  it('states', () => {
    expect(proposalCardState(view())).toBe('open')
    expect(proposalCardState(view({ needsInput: 'label' }))).toBe('needs-website')
    expect(proposalCardState(view({ taskGone: true }))).toBe('changed')
    expect(proposalCardState(view({ status: 'UNDONE' }))).toBe('undone')
  })
})

describe('loadProposalCardView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(loadPostFilter).mockResolvedValue(EMPTY_POST_FILTER)
    vi.mocked(prisma.callRecording.findUnique).mockResolvedValue({ id: 'rec1', updatedAt: NOW, crewId: 'ops', crewLabel: 'Ops', title: 'Weekly', eventName: null, startedAt: NOW, source: 'DISCORD', status: 'PUBLISHED', transcript: [] } as never)
  })
  const prop = (o: Record<string, unknown> = {}) =>
    ({ id: 'p1', recordingId: 'rec1', crewId: 'ops', kind: 'UPDATE', taskId: 't1', baseUpdatedAt: NOW, changes: { leadName: { from: null, to: 'Alex' } }, edited: null, leadName: 'Alex', leadMemberId: null, candidates: [{ memberId: '1', name: 'Alex A' }, { memberId: '2', name: 'Alex B' }], reason: 'why', status: 'PENDING', decidedBy: null, decidedAt: null, error: null, createdAt: NOW, card: null, ...o }) as never

  it('ambiguous lead needs the website; a lead picked there (edited) does not', async () => {
    vi.mocked(prisma.crewTask.findUnique).mockResolvedValue({ label: 'Order stickers', updatedAt: NOW, archived: false } as never)
    vi.mocked(prisma.crewTaskProposal.findUnique).mockResolvedValueOnce(prop())
    const v = await loadProposalCardView('p1')
    expect(v?.needsInput).toBe('lead')
    expect(v?.leadCandidates).toEqual(['Alex A', 'Alex B'])
    vi.mocked(prisma.crewTaskProposal.findUnique).mockResolvedValueOnce(prop({ edited: { leadMemberId: '1', leadName: 'Alex A' } }))
    const w = await loadProposalCardView('p1')
    expect(w?.needsInput).toBeNull()
    expect(w?.lead?.to).toBe('Alex A')
  })

  it('the stale check: a task updated since the proposal is "changed"', async () => {
    vi.mocked(prisma.crewTask.findUnique).mockResolvedValue({ label: 'Order stickers', updatedAt: new Date(NOW.getTime() + 1000), archived: false } as never)
    vi.mocked(prisma.crewTaskProposal.findUnique).mockResolvedValueOnce(prop({ candidates: null, changes: { stage: { from: 'a', to: 'b' } } }))
    expect(proposalCardState((await loadProposalCardView('p1'))!)).toBe('changed')
  })

  it('an excluded crew, an owner-held call or an unreadable filter hides it', async () => {
    vi.mocked(prisma.crewTask.findUnique).mockResolvedValue({ label: 'x', updatedAt: NOW, archived: false } as never)
    vi.mocked(prisma.crewTaskProposal.findUnique).mockResolvedValue(prop())
    vi.mocked(loadPostFilter).mockResolvedValueOnce({ ...EMPTY_POST_FILTER, excludedCrewIds: ['ops'] })
    expect((await loadProposalCardView('p1'))?.hidden).toBe(true)
    vi.mocked(loadPostFilter).mockResolvedValueOnce({ ...EMPTY_POST_FILTER, ownerOnlyCrewIds: ['ops'] })
    expect((await loadProposalCardView('p1'))?.hidden).toBe(true)
    vi.mocked(loadPostFilter).mockRejectedValueOnce(new Error('db'))
    expect((await loadProposalCardView('p1'))?.hidden).toBe(true)
    vi.mocked(prisma.callRecording.findUnique).mockResolvedValue({ id: 'rec2', updatedAt: NOW, crewId: 'ops', crewLabel: 'Ops', title: 'W', startedAt: NOW, reviewHoldAt: NOW } as never)
    expect((await loadProposalCardView('p1'))?.hidden).toBe(true)
  })
})

describe('syncTaskProposalCard', () => {
  it('toggle off: no post', async () => {
    const { state, deps } = makeDeps(view(), { enabled: () => false })
    expect(await syncTaskProposalCard('p', deps)).toBe('disabled')
    expect(state.posts).toHaveLength(0)
  })

  it('posts once, stores it; a second sync is unchanged (no Discord call)', async () => {
    const { state, deps } = makeDeps(view())
    expect(await syncTaskProposalCard('p', deps)).toBe('posted')
    expect(state.v.card?.messageId).toBe('222222222222222222')
    expect(await syncTaskProposalCard('p', deps)).toBe('unchanged')
    expect(state.posts).toHaveLength(1)
    expect(state.edits).toHaveLength(0)
  })

  it('a channel that is not private gets no post', async () => {
    const { state, deps } = makeDeps(view(), { channelIsPrivate: async () => false })
    expect(await syncTaskProposalCard('p', deps)).toBe('channel_not_private')
    expect(state.posts).toHaveLength(0)
    expect(state.claimed).toBe(false)
  })

  it('a hidden or too old proposal gets no card', async () => {
    expect(await syncTaskProposalCard('p', makeDeps(view({ hidden: true })).deps)).toBe('no_card_needed')
    expect(await syncTaskProposalCard('p', makeDeps(view({ createdAt: new Date('2026-10-01T00:00:00Z') })).deps)).toBe('no_card_needed')
  })

  it('edits only when the render changed, and resolves after a decision on the website', async () => {
    const { state, deps } = makeDeps(view())
    await syncTaskProposalCard('p', deps)
    expect(await syncTaskProposalCard('p', deps)).toBe('unchanged')
    // Decided on the website: the next sync (queued by the route, or the sweep) edits the card.
    state.v = { ...state.v, status: 'APPLIED', decidedBy: '333333333333333333', decidedAt: NOW }
    expect(await syncTaskProposalCard('p', deps, { editOnly: true })).toBe('edited')
    expect(text(state.edits[0])).toContain('Applied by <@333333333333333333>')
    expect(buttons(state.edits[0]).map((b) => b.label)).toEqual(['Open on website'])
    expect(state.v.card?.resolvedAt).toEqual(NOW)
    expect(state.v.card?.renderedHash).toBe(renderHash(state.edits[0]))
  })

  it('editOnly never posts a new card', async () => {
    const { state, deps } = makeDeps(view())
    expect(await syncTaskProposalCard('p', deps, { editOnly: true })).toBe('no_card_needed')
    expect(state.posts).toHaveLength(0)
  })

  it('an existing card is collapsed when its channel is no longer private', async () => {
    const { state, deps } = makeDeps(view())
    await syncTaskProposalCard('p', deps)
    deps.channelIsPrivate = async () => false
    expect(await syncTaskProposalCard('p', deps)).toBe('edited')
    expect(text(state.edits[0])).not.toContain('They said')
  })

  it('a deleted message is forgotten; a live proposal is posted again, a decided one is not', async () => {
    const gone = new DiscordPostError('gone', 404)
    const a = makeDeps(view({ card: { channelId: '111111111111111111', messageId: '2', renderedHash: 'old', resolvedAt: null, claimedAt: NOW } }), { edit: async () => { throw gone } })
    expect(await syncTaskProposalCard('p', a.deps)).toBe('posted')
    const b = makeDeps(view({ status: 'DISMISSED', card: { channelId: '111111111111111111', messageId: '2', renderedHash: 'old', resolvedAt: null, claimedAt: NOW } }), { edit: async () => { throw gone } })
    expect(await syncTaskProposalCard('p', b.deps)).toBe('no_card_needed')
    expect(b.state.posts).toHaveLength(0)
  })

  it('never throws', async () => {
    const { deps } = makeDeps(view(), { post: async () => { throw new Error('boom') } })
    expect(await syncTaskProposalCard('p', deps)).toBe('failed')
  })
})

describe('syncDueTaskProposalCards', () => {
  it('toggle off or no channel: skipped, nothing listed', async () => {
    const listNew = vi.fn<ProposalSweepDeps['listNew']>(async () => ['p'])
    expect(await syncDueTaskProposalCards(10, makeDeps(view(), { enabled: () => false, listNew }).deps)).toEqual({ skipped: 'disabled' })
    expect(await syncDueTaskProposalCards(10, makeDeps(view(), { channelId: async () => '', listNew }).deps)).toEqual({ skipped: 'no channel' })
    expect(listNew).not.toHaveBeenCalled()
  })

  it('only proposals made since the switch went on (and inside the age window) are posted', async () => {
    const listNew = vi.fn<ProposalSweepDeps['listNew']>(async () => ['p'])
    const { state, deps } = makeDeps(view(), { listNew })
    expect(await syncDueTaskProposalCards(10, deps)).toMatchObject({ posted: 1 })
    expect(listNew.mock.calls[0][0]).toEqual(new Date('2026-11-18T00:00:00Z'))
    expect(state.posts).toHaveLength(1)
    // Switched on long ago: the age window is the floor.
    const l2 = vi.fn<ProposalSweepDeps['listNew']>(async () => [] as string[])
    await syncDueTaskProposalCards(10, makeDeps(view(), { listNew: l2, since: async () => new Date('2026-01-01T00:00:00Z') }).deps)
    expect(l2.mock.calls[0][0]).toEqual(new Date(NOW.getTime() - 14 * 86_400_000))
  })

  it('no saved switch-on time: nothing new is posted', async () => {
    const listNew = vi.fn<ProposalSweepDeps['listNew']>(async () => ['p'])
    const { state, deps } = makeDeps(view(), { listNew, since: async () => null })
    expect(await syncDueTaskProposalCards(10, deps)).toMatchObject({ posted: 0 })
    expect(listNew).not.toHaveBeenCalled()
    expect(state.posts).toHaveLength(0)
  })

  it('skips existing cards whose marker is unchanged; re-checks when it, privacy or the toggle change', async () => {
    const memo = new Map<string, { key: string; at: number }>()
    let marker = 'm1'
    let priv = true
    const load = vi.fn()
    const { state, deps } = makeDeps(view({ card: { channelId: '111111111111111111', messageId: '2', renderedHash: null, resolvedAt: null, claimedAt: NOW } }), {
      memo,
      listExisting: async () => ['p'],
      markers: async () => new Map([['p', marker]]),
      channelIsPrivate: async () => priv,
    })
    const inner = deps.load
    deps.load = async (id) => (load(id), inner(id))
    await syncDueTaskProposalCards(10, deps)
    await syncDueTaskProposalCards(10, deps)
    expect(load).toHaveBeenCalledTimes(1)
    marker = 'm2'
    await syncDueTaskProposalCards(10, deps)
    expect(load).toHaveBeenCalledTimes(2)
    priv = false
    await syncDueTaskProposalCards(10, deps)
    expect(load).toHaveBeenCalledTimes(3)
    expect(state.edits.length).toBeGreaterThan(0)
  })
})
