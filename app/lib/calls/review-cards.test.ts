import { describe, expect, it, vi } from 'vitest'

vi.mock('@/app/lib/db', () => ({ prisma: {} }))
vi.mock('next/server', () => ({ after: (fn: () => unknown) => void fn() }))

import {
  cardState,
  cardVersion,
  everyoneDeniedView,
  needsNewCard,
  renderCallReviewCard,
  renderHash,
  syncCallReviewCard,
  syncDueCallReviewCards,
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
      state.errors.push(s.error)
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
  it('open: summary, action items and a single link button, no pings', () => {
    const m = renderCallReviewCard(view(), { appUrl: APP })
    expect(m.allowed_mentions).toEqual({ parse: [] })
    expect(m.embeds[0].description).toContain('Needs review: Ops')
    expect(m.embeds[0].description).toContain('We agreed on the plan')
    expect(m.embeds[0].fields?.[0].value).toContain('Write the doc')
    const buttons = (m.components[0] as { components: Array<{ style: number; url?: string; custom_id?: string }> }).components
    expect(buttons).toHaveLength(1)
    expect(buttons[0].style).toBe(5)
    expect(buttons[0].url).toBe(`${APP}/admin/calls/rec1`)
    expect(buttons[0].custom_id).toBeUndefined()
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

  it('notes stale redactions on an open card', () => {
    const m = renderCallReviewCard(view({ staleRedactions: true }), { appUrl: APP })
    expect(JSON.stringify(m)).toContain('hidden after the summary')
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
  it('cardVersion is the newest of the three stamps, base36', () => {
    const a = new Date('2026-11-01T00:00:00Z')
    const b = new Date('2026-11-02T00:00:00Z')
    expect(cardVersion({ summaryGeneratedAt: a })).toBe(a.getTime().toString(36))
    expect(cardVersion({ summaryGeneratedAt: a, summaryEditedAt: b })).toBe(b.getTime().toString(36))
    expect(cardVersion({})).toBe('0')
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

describe('everyoneDeniedView', () => {
  const ch = (ow: Array<{ id: string; type: number; allow: string; deny: string }> | undefined) => ({ guildId: 'g1', permissionOverwrites: ow })
  it('needs a role overwrite on the guild id that denies View Channel', () => {
    expect(everyoneDeniedView(ch([{ id: 'g1', type: 0, allow: '0', deny: '1024' }]))).toBe(true)
    expect(everyoneDeniedView(ch([{ id: 'g1', type: 0, allow: '0', deny: '3072' }]))).toBe(true)
  })
  it('fails closed on everything else', () => {
    expect(everyoneDeniedView(ch([{ id: 'g1', type: 0, allow: '1024', deny: '0' }]))).toBe(false)
    expect(everyoneDeniedView(ch([{ id: 'g1', type: 0, allow: '0', deny: '2048' }]))).toBe(false)
    expect(everyoneDeniedView(ch([{ id: 'other', type: 0, allow: '0', deny: '1024' }]))).toBe(false)
    expect(everyoneDeniedView(ch([{ id: 'g1', type: 1, allow: '0', deny: '1024' }]))).toBe(false)
    expect(everyoneDeniedView(ch([]))).toBe(false)
    expect(everyoneDeniedView(ch(undefined))).toBe(false)
    expect(everyoneDeniedView({ guildId: null, permissionOverwrites: [{ id: 'g1', type: 0, allow: '0', deny: '1024' }] })).toBe(false)
    expect(everyoneDeniedView(null)).toBe(false)
    expect(everyoneDeniedView(ch([{ id: 'g1', type: 0, allow: 'x', deny: 'y' }]))).toBe(false)
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
