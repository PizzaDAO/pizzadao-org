import { describe, expect, it, vi } from 'vitest'

vi.mock('@/app/lib/db', () => ({ prisma: {} }))
vi.mock('next/server', () => ({ after: (fn: () => unknown) => void fn() }))

import {
  cardState,
  cardVersion,
  channelIsPrivateFor,
  POSTED_UNSTORED,
  needsNewCard,
  renderCallReviewCard,
  renderHash,
  syncCallReviewCard,
  syncDueCallReviewCards,
  SWEEP_FULL_RECHECK_MS,
  type CallCardView,
  type SweepDeps,
} from './review-cards'
import { DiscordPostError } from '@/app/lib/discord-rest'

const NOW = new Date('2026-11-18T12:00:00Z')
const APP = 'https://app.example.test'

function view(o: Partial<CallCardView> = {}): CallCardView {
  return {
    id: 'rec1',
    source: 'DISCORD',
    status: 'IN_REVIEW',
    crewLabel: 'Ops',
    title: 'Weekly sync',
    startedAt: new Date('2026-11-17T18:00:00Z'),
    summary: 'We agreed on the plan for the launch.',
    actionItems: [{ text: 'Write the doc', owner: 'Sam' }],
    held: null,
    staleRedactions: false,
    interactive: true,
    version: 'abc',
    reviewedBy: null,
    reviewedAt: null,
    publishedVia: null,
    card: null,
    ...o,
  }
}

/** In-memory deps: a single call row and its card, a Discord that records what it was asked. */
function makeDeps(initial: CallCardView, over: Partial<SweepDeps> = {}) {
  const state = { v: initial, claimed: false, posts: [] as unknown[], edits: [] as unknown[], saved: [] as unknown[], errors: [] as Array<string | null> }
  const deps: SweepDeps = {
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
      state.errors.push(s.error ?? null)
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
    listNew: async () => [],
    listExisting: async () => [],
    ...over,
  }
  return { state, deps }
}

describe('renderCallReviewCard', () => {
  it('open: summary, action items, Approve / Needs owner buttons with the version and a link, no pings', () => {
    const m = renderCallReviewCard(view(), { appUrl: APP })
    expect(m.allowed_mentions).toEqual({ parse: [] })
    expect(m.embeds[0].description).toContain('Needs review: Ops')
    expect(m.embeds[0].description).toContain('We agreed on the plan')
    expect(m.embeds[0].fields?.[0].value).toContain('Write the doc')
    const buttons = (m.components[0] as { components: Array<{ style: number; url?: string; custom_id?: string }> }).components
    expect(buttons.map((b) => b.custom_id ?? b.url)).toEqual(['cr:approve:rec1:abc', 'cr:hold:rec1', `${APP}/admin/calls/rec1`])
    expect(buttons.every((b) => (b.custom_id ?? '').length < 100)).toBe(true)
  })

  it('a version change changes the render hash (the card is edited so an old Approve is refused)', () => {
    expect(renderHash(renderCallReviewCard(view({ version: 'abd' }), { appUrl: APP }))).not.toBe(renderHash(renderCallReviewCard(view(), { appUrl: APP })))
  })

  it('without capo review on (not interactive) an open card has only the link, and the hash differs', () => {
    const off = renderCallReviewCard(view({ interactive: false }), { appUrl: APP })
    const buttons = (off.components[0] as { components: Array<{ custom_id?: string }> }).components
    expect(buttons).toHaveLength(1)
    expect(buttons[0].custom_id).toBeUndefined()
    expect(renderHash(off)).not.toBe(renderHash(renderCallReviewCard(view(), { appUrl: APP })))
  })

  it('resolved and held cards have only the link button', () => {
    for (const v of [view({ held: 'manual' }), view({ status: 'PUBLISHED' }), view({ status: 'REJECTED' })]) {
      const buttons = (renderCallReviewCard(v, { appUrl: APP }).components[0] as { components: Array<{ custom_id?: string; url?: string }> }).components
      expect(buttons).toHaveLength(1)
      expect(buttons[0].custom_id).toBeUndefined()
    }
  })

  it('clips the summary and caps the action items, neutralizing mentions', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ text: `item ${i} <@123456789012345678>`, owner: null }))
    const m = renderCallReviewCard(view({ summary: 'x'.repeat(3000), actionItems: items }), { appUrl: APP })
    expect(m.embeds[0].description.length).toBeLessThan(1200)
    const f = m.embeds[0].fields![0].value
    expect(f.split('\n')).toHaveLength(8)
    expect(f).not.toContain('<@123456789012345678>')
  })

  it('held (manual or automatic): no summary, no action items, no title', () => {
    for (const held of ['manual', 'term', 'crew', 'unreadable'] as const) {
      const m = renderCallReviewCard(view({ held, summary: 'SECRET summary', title: 'SECRET title' }), { appUrl: APP })
      const text = JSON.stringify(m)
      expect(text).not.toContain('SECRET')
      expect(text).not.toContain('Write the doc')
      expect(m.embeds[0].description).toContain('Held for owner review: Ops')
      expect(m.embeds[0].fields).toBeUndefined()
    }
  })

  it('published shows who and where; removed shows removed; neither shows the summary', () => {
    const pub = renderCallReviewCard(view({ status: 'PUBLISHED', reviewedBy: '123456789012345678', reviewedAt: NOW, publishedVia: 'discord' }), { appUrl: APP })
    expect(pub.embeds[0].description).toContain('Published by <@123456789012345678> via Discord')
    expect(pub.embeds[0].description).not.toContain('We agreed')
    expect(pub.allowed_mentions).toEqual({ parse: [] })
    const web = renderCallReviewCard(view({ status: 'PUBLISHED', reviewedBy: '123456789012345678', publishedVia: 'web' }), { appUrl: APP })
    expect(web.embeds[0].description).toContain('via the website')
    const rm = renderCallReviewCard(view({ status: 'REJECTED' }), { appUrl: APP })
    expect(rm.embeds[0].description).toContain('Removed: Ops')
    expect(rm.embeds[0].description).not.toContain('We agreed')
  })

  it('stale redactions: rendered like a held card (no summary, no action items), with the note and website link only', () => {
    const m = renderCallReviewCard(view({ staleRedactions: true, summary: 'SECRET summary' }), { appUrl: APP })
    const text = JSON.stringify(m)
    expect(text).toContain('hidden after the summary')
    expect(text).not.toContain('SECRET')
    expect(text).not.toContain('Write the doc')
    expect(m.embeds[0].fields).toBeUndefined()
    const buttons = (m.components[0] as { components: Array<{ custom_id?: string; url?: string }> }).components
    expect(buttons).toHaveLength(1)
    expect(buttons[0].url).toBe(`${APP}/admin/calls/rec1`)
    expect(cardState({ status: 'IN_REVIEW', held: null, staleRedactions: true })).toBe('stale')
  })

  it('same view renders the same hash; a changed summary changes it', () => {
    const a = renderHash(renderCallReviewCard(view(), { appUrl: APP }))
    expect(renderHash(renderCallReviewCard(view(), { appUrl: APP }))).toBe(a)
    expect(renderHash(renderCallReviewCard(view({ summary: 'new' }), { appUrl: APP }))).not.toBe(a)
  })
})

describe('state and version helpers', () => {
  it('cardState', () => {
    expect(cardState({ status: 'IN_REVIEW', held: null })).toBe('open')
    expect(cardState({ status: 'IN_REVIEW', held: 'manual' })).toBe('held')
    expect(cardState({ status: 'PUBLISHED', held: 'manual' })).toBe('published')
    expect(cardState({ status: 'REJECTED', held: null })).toBe('removed')
  })
  it('cardVersion: the newest of the three stamps in base36 plus a title hash; [0-9a-z] only, fits a custom id', () => {
    const a = new Date('2026-11-01T00:00:00Z')
    const b = new Date('2026-11-02T00:00:00Z')
    expect(cardVersion({ summaryGeneratedAt: a, title: 'T' }).startsWith(a.getTime().toString(36))).toBe(true)
    expect(cardVersion({ summaryGeneratedAt: a, summaryEditedAt: b, title: 'T' }).startsWith(b.getTime().toString(36))).toBe(true)
    expect(cardVersion({ summaryGeneratedAt: a, title: 'T' })).not.toBe(cardVersion({ summaryGeneratedAt: a, title: 'T2' }))
    expect(cardVersion({ summaryGeneratedAt: a, title: 'T' })).toBe(cardVersion({ summaryGeneratedAt: a, title: 'T' }))
    expect(cardVersion({ summaryGeneratedAt: a, title: 'T' })).toMatch(/^[0-9a-z]{1,16}$/)
    expect(cardVersion({})).toMatch(/^0[0-9a-z]{4}$/)
  })
  it('needsNewCard: discord, in review, summarized, not held, in the age window', () => {
    expect(needsNewCard(view(), NOW, 14)).toBe(true)
    expect(needsNewCard(view({ source: 'X_BROADCAST' }), NOW, 14)).toBe(false)
    expect(needsNewCard(view({ summary: ' ' }), NOW, 14)).toBe(false)
    expect(needsNewCard(view({ held: 'term' }), NOW, 14)).toBe(false)
    expect(needsNewCard(view({ status: 'PUBLISHED' }), NOW, 14)).toBe(false)
    expect(needsNewCard(view({ startedAt: new Date('2026-10-01T00:00:00Z') }), NOW, 14)).toBe(false)
  })
})

describe('channelIsPrivateFor', () => {
  const OPTS = { guildId: 'g1', allowedIds: ['capo-role', 'dpr-role', 'bot-user'] }
  const EVERYONE = { id: 'g1', type: 0, allow: '0', deny: '1024' }
  const ch = (ow: Array<{ id: string; type: number; allow: string; deny: string }> | undefined, guildId: string | null = 'g1') => ({ guildId, permissionOverwrites: ow })
  it('private: @everyone denied, nobody else outside the allow-list granted View Channel', () => {
    expect(channelIsPrivateFor(ch([EVERYONE]), OPTS)).toBe(true)
    expect(channelIsPrivateFor(ch([{ ...EVERYONE, deny: '3072' }]), OPTS)).toBe(true)
  })
  it('allow-listed roles and the bot may be granted View Channel', () => {
    expect(channelIsPrivateFor(ch([EVERYONE, { id: 'capo-role', type: 0, allow: '1024', deny: '0' }, { id: 'dpr-role', type: 0, allow: '1024', deny: '0' }, { id: 'bot-user', type: 1, allow: '1024', deny: '0' }]), OPTS)).toBe(true)
  })
  it('refused when another role is re-granted View Channel (e.g. Verified)', () => {
    expect(channelIsPrivateFor(ch([EVERYONE, { id: 'verified-role', type: 0, allow: '1024', deny: '0' }]), OPTS)).toBe(false)
    expect(channelIsPrivateFor(ch([EVERYONE, { id: 'capo-role', type: 0, allow: '1024', deny: '0' }, { id: 'verified-role', type: 0, allow: '3072', deny: '0' }]), OPTS)).toBe(false)
  })
  it('refused when a member overwrite outside the allow-list grants View Channel', () => {
    expect(channelIsPrivateFor(ch([EVERYONE, { id: 'some-member', type: 1, allow: '1024', deny: '0' }]), OPTS)).toBe(false)
  })
  it('a deny-only overwrite on another role is fine', () => {
    expect(channelIsPrivateFor(ch([EVERYONE, { id: 'verified-role', type: 0, allow: '0', deny: '1024' }]), OPTS)).toBe(true)
  })
  it('refused for a channel in another guild, or with no configured guild', () => {
    expect(channelIsPrivateFor(ch([{ ...EVERYONE, id: 'g2' }], 'g2'), OPTS)).toBe(false)
    expect(channelIsPrivateFor(ch([EVERYONE]), { ...OPTS, guildId: '' })).toBe(false)
  })
  it('fails closed on everything else', () => {
    expect(channelIsPrivateFor(ch([{ ...EVERYONE, allow: '1024', deny: '0' }]), OPTS)).toBe(false)
    expect(channelIsPrivateFor(ch([{ ...EVERYONE, deny: '2048' }]), OPTS)).toBe(false)
    expect(channelIsPrivateFor(ch([{ ...EVERYONE, id: 'other' }]), OPTS)).toBe(false)
    expect(channelIsPrivateFor(ch([{ ...EVERYONE, type: 1 }]), OPTS)).toBe(false)
    expect(channelIsPrivateFor(ch([]), OPTS)).toBe(false)
    expect(channelIsPrivateFor(ch(undefined), OPTS)).toBe(false)
    expect(channelIsPrivateFor(ch([EVERYONE], null), OPTS)).toBe(false)
    expect(channelIsPrivateFor(null, OPTS)).toBe(false)
    expect(channelIsPrivateFor(ch([{ ...EVERYONE, allow: 'x', deny: 'y' }]), OPTS)).toBe(false)
  })
})

describe('syncCallReviewCard', () => {
  it('does nothing when disabled', async () => {
    const { state, deps } = makeDeps(view(), { enabled: () => false })
    expect(await syncCallReviewCard('rec1', deps)).toBe('disabled')
    expect(state.posts).toHaveLength(0)
  })

  it('posts one card, stores it, and a second sync is unchanged', async () => {
    const { state, deps } = makeDeps(view())
    expect(await syncCallReviewCard('rec1', deps)).toBe('posted')
    expect(state.posts).toHaveLength(1)
    expect(state.v.card?.messageId).toBe('222222222222222222')
    expect(await syncCallReviewCard('rec1', deps)).toBe('unchanged')
    expect(state.posts).toHaveLength(1)
    expect(state.edits).toHaveLength(0)
  })

  it('two concurrent syncs produce one post (the claim)', async () => {
    const { state, deps } = makeDeps(view())
    const [a, b] = await Promise.all([syncCallReviewCard('rec1', deps), syncCallReviewCard('rec1', deps)])
    expect([a, b].sort()).toEqual(['claimed_elsewhere', 'posted'])
    expect(state.posts).toHaveLength(1)
  })

  it('a failed post unclaims, records the error and does not throw', async () => {
    const { state, deps } = makeDeps(view(), { post: async () => { throw new Error('Discord API error 500 https://discord.com/x') } })
    expect(await syncCallReviewCard('rec1', deps)).toBe('failed')
    expect(state.claimed).toBe(false)
    expect(state.errors.at(-1)).toMatch(/Discord API error 500/)
    expect(state.errors.at(-1)).not.toContain('https://')
  })

  it('a channel that is not private gets no post', async () => {
    const { state, deps } = makeDeps(view(), { channelIsPrivate: async () => false })
    expect(await syncCallReviewCard('rec1', deps)).toBe('channel_not_private')
    expect(state.posts).toHaveLength(0)
    expect(state.claimed).toBe(false)
    expect(state.errors).toContain('channel not private')
  })

  it('no channel setting: no post', async () => {
    const { state, deps } = makeDeps(view(), { channelId: async () => '' })
    expect(await syncCallReviewCard('rec1', deps)).toBe('no_channel')
    expect(state.posts).toHaveLength(0)
  })

  it('imported calls never get a card', async () => {
    const { state, deps } = makeDeps(view({ source: 'X_BROADCAST' }))
    expect(await syncCallReviewCard('rec1', deps)).toBe('no_card_needed')
    expect(state.posts).toHaveLength(0)
  })

  it('a held call with no card gets none; too old gets none', async () => {
    expect(await syncCallReviewCard('rec1', makeDeps(view({ held: 'manual' })).deps)).toBe('no_card_needed')
    expect(await syncCallReviewCard('rec1', makeDeps(view({ startedAt: new Date('2026-10-01T00:00:00Z') })).deps)).toBe('no_card_needed')
  })

  it('edits only when the render changed, and resolves when published', async () => {
    const { state, deps } = makeDeps(view())
    await syncCallReviewCard('rec1', deps)
    state.v = { ...state.v, summary: 'An edited summary.' }
    expect(await syncCallReviewCard('rec1', deps)).toBe('edited')
    expect(state.edits).toHaveLength(1)
    expect(JSON.stringify(state.edits[0])).toContain('An edited summary.')
    state.v = { ...state.v, status: 'PUBLISHED', reviewedBy: '123456789012345678', reviewedAt: NOW, publishedVia: 'web' }
    expect(await syncCallReviewCard('rec1', deps)).toBe('edited')
    expect(state.v.card?.resolvedAt).toEqual(NOW)
    expect(JSON.stringify(state.edits[1])).not.toContain('An edited summary.')
    expect(await syncCallReviewCard('rec1', deps)).toBe('unchanged')
  })

  it('a hold collapses an existing card; releasing reopens it', async () => {
    const { state, deps } = makeDeps(view())
    await syncCallReviewCard('rec1', deps)
    state.v = { ...state.v, held: 'manual' }
    await syncCallReviewCard('rec1', deps)
    expect(JSON.stringify(state.edits[0])).not.toContain('We agreed')
    expect(state.v.card?.resolvedAt).not.toBeNull()
    state.v = { ...state.v, held: null }
    await syncCallReviewCard('rec1', deps)
    expect(JSON.stringify(state.edits[1])).toContain('We agreed')
    expect(state.v.card?.resolvedAt).toBeNull()
  })

  it('an unpublished call comes back as an open card (edited in place)', async () => {
    const { state, deps } = makeDeps(view({ status: 'PUBLISHED', reviewedBy: '1' }))
    state.v.card = { channelId: '111111111111111111', messageId: '222222222222222222', renderedHash: 'old', resolvedAt: NOW, claimedAt: NOW }
    state.v = { ...state.v, status: 'IN_REVIEW' }
    expect(await syncCallReviewCard('rec1', deps)).toBe('edited')
    expect(state.posts).toHaveLength(0)
    expect(state.v.card?.resolvedAt).toBeNull()
  })

  it('a deleted Discord message (404) is forgotten and re-posted while open', async () => {
    let first = true
    const { state, deps } = makeDeps(view(), {
      edit: async (_c, m) => {
        if (first) {
          first = false
          throw new DiscordPostError('gone', 404)
        }
        state.edits.push(m)
      },
    })
    state.v.card = { channelId: '111111111111111111', messageId: '999999999999999999', renderedHash: 'old', resolvedAt: null, claimedAt: NOW }
    expect(await syncCallReviewCard('rec1', deps)).toBe('posted')
    expect(state.posts).toHaveLength(1)
    expect(state.v.card?.messageId).toBe('222222222222222222')
  })

  it('a 404 on a resolved card is not re-posted', async () => {
    const { state, deps } = makeDeps(view({ status: 'PUBLISHED' }), { edit: async () => { throw new DiscordPostError('gone', 404) } })
    state.v.card = { channelId: '111111111111111111', messageId: '999999999999999999', renderedHash: 'old', resolvedAt: NOW, claimedAt: NOW }
    expect(await syncCallReviewCard('rec1', deps)).toBe('no_card_needed')
    expect(state.posts).toHaveLength(0)
  })

  it('other edit failures are swallowed as failed', async () => {
    const { deps, state } = makeDeps(view(), { edit: async () => { throw new DiscordPostError('boom', 500) } })
    state.v.card = { channelId: '111111111111111111', messageId: '999999999999999999', renderedHash: 'old', resolvedAt: null, claimedAt: NOW }
    expect(await syncCallReviewCard('rec1', deps)).toBe('failed')
  })
})

describe('syncCallReviewCard: privacy re-check and post safety', () => {
  const OPEN_CARD = { channelId: '111111111111111111', messageId: '222222222222222222', renderedHash: 'old', resolvedAt: null, claimedAt: NOW }
  it('an existing open card is collapsed when its channel is no longer private', async () => {
    const { state, deps } = makeDeps(view(), { channelIsPrivate: async () => false })
    state.v.card = { ...OPEN_CARD }
    expect(await syncCallReviewCard('rec1', deps)).toBe('edited')
    const text = JSON.stringify(state.edits[0])
    expect(text).not.toContain('We agreed')
    expect(text).toContain('Held for owner review')
  })
  it('an existing open card is collapsed when its channel is not the configured one any more', async () => {
    const { state, deps } = makeDeps(view(), { channelId: async () => '999999999999999999' })
    state.v.card = { ...OPEN_CARD }
    expect(await syncCallReviewCard('rec1', deps)).toBe('edited')
    expect(JSON.stringify(state.edits[0])).not.toContain('We agreed')
  })
  it('a private, configured channel keeps the summary', async () => {
    const { state, deps } = makeDeps(view())
    state.v.card = { ...OPEN_CARD }
    await syncCallReviewCard('rec1', deps)
    expect(JSON.stringify(state.edits[0])).toContain('We agreed')
  })
  it('a post with no message id is a failure and blocks an automatic repost', async () => {
    const { state, deps } = makeDeps(view(), { post: async () => ({ id: null }) })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await syncCallReviewCard('rec1', deps)).toBe('failed')
    expect(state.claimed).toBe(true) // not unclaimed
    expect(state.errors.at(-1)).toContain(POSTED_UNSTORED)
    expect(state.v.card?.messageId ?? null).toBeNull()
  })
  it('a store that fails once is retried; failing twice blocks a repost and keeps the message id in the error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let n = 0
    const once = makeDeps(view())
    const realStore = once.deps.store
    once.deps.store = async (id, c) => {
      if (n++ === 0) throw new Error('db blip')
      return realStore(id, c)
    }
    expect(await syncCallReviewCard('rec1', once.deps)).toBe('posted')
    expect(once.state.posts).toHaveLength(1)

    const twice = makeDeps(view(), { store: async () => { throw new Error('db down') } })
    expect(await syncCallReviewCard('rec1', twice.deps)).toBe('failed')
    expect(twice.state.posts).toHaveLength(1)
    expect(twice.state.claimed).toBe(true)
    expect(twice.state.errors.at(-1)).toBe(`${POSTED_UNSTORED}: 222222222222222222`)
  })
  it('a held call with no card is remembered so the sweep does not keep picking it', async () => {
    const { state, deps } = makeDeps(view({ held: 'term' }))
    expect(await syncCallReviewCard('rec1', deps)).toBe('no_card_needed')
    expect(state.saved).toEqual([{ resolvedAt: NOW }])
  })
})

describe('syncDueCallReviewCards', () => {
  it('skips when disabled or without a channel', async () => {
    expect(await syncDueCallReviewCards(5, makeDeps(view(), { enabled: () => false }).deps)).toEqual({ skipped: 'disabled' })
    expect(await syncDueCallReviewCards(5, makeDeps(view(), { channelId: async () => '' }).deps)).toEqual({ skipped: 'no channel' })
  })

  it('asks for candidates inside the age window and posts at most `limit` cards', async () => {
    const ids = ['a', 'b', 'c', 'd']
    const listNew = vi.fn(async () => ids)
    const posted: string[] = []
    const { deps } = makeDeps(view(), {
      listNew,
      load: async (id) => view({ id }),
      claim: async () => true,
      post: async () => (posted.push('x'), { id: '222222222222222222' }),
    })
    const out = await syncDueCallReviewCards(2, deps)
    expect(listNew).toHaveBeenCalledWith(new Date(NOW.getTime() - 14 * 86_400_000), 8)
    expect(out).toMatchObject({ posted: 2 })
    expect(posted).toHaveLength(2)
  })

  it('re-renders existing cards and counts edits', async () => {
    const { state, deps } = makeDeps(view(), { listExisting: async () => ['rec1'] })
    state.v.card = { channelId: '111111111111111111', messageId: '222222222222222222', renderedHash: 'stale', resolvedAt: null, claimedAt: NOW }
    expect(await syncDueCallReviewCards(5, deps)).toMatchObject({ posted: 0, edited: 1 })
  })
})

describe('sweep change markers', () => {
  function setup(markerOf: () => string) {
    const memo = new Map<string, { key: string; at: number }>()
    let t = NOW.getTime()
    const card = { channelId: '111111111111111111', messageId: '222222222222222222', renderedHash: renderHash(renderCallReviewCard(view(), { appUrl: APP })), resolvedAt: null, claimedAt: null }
    const load = vi.fn(async (id: string) => view({ id, card }))
    const mk = () => makeDeps(view({ card }), { listExisting: async () => ['rec1'], load, markers: async () => new Map([['rec1', markerOf()]]), filterKey: async () => 'f', memo, now: () => new Date(t) })
    return { load, mk, advance: (ms: number) => (t += ms) }
  }

  it('does not load the row (transcript) again when the marker is unchanged', async () => {
    const s = setup(() => 'm1')
    const { deps } = s.mk()
    await syncDueCallReviewCards(5, deps)
    expect(s.load).toHaveBeenCalledTimes(1)
    await syncDueCallReviewCards(5, deps)
    await syncDueCallReviewCards(5, deps)
    expect(s.load).toHaveBeenCalledTimes(1)
  })

  it('loads again when the marker changes', async () => {
    let m = 'm1'
    const s = setup(() => m)
    const { deps } = s.mk()
    await syncDueCallReviewCards(5, deps)
    m = 'm2'
    await syncDueCallReviewCards(5, deps)
    expect(s.load).toHaveBeenCalledTimes(2)
  })

  it('does a full re-check after the interval', async () => {
    const s = setup(() => 'm1')
    const { deps } = s.mk()
    await syncDueCallReviewCards(5, deps)
    s.advance(SWEEP_FULL_RECHECK_MS - 1000)
    await syncDueCallReviewCards(5, deps)
    expect(s.load).toHaveBeenCalledTimes(1)
    s.advance(2000)
    await syncDueCallReviewCards(5, deps)
    expect(s.load).toHaveBeenCalledTimes(2)
  })
})
