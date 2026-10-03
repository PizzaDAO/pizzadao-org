// @vitest-environment node
// Review cards (Phase 3): rendering and the post / edit sync, with injected deps.
import { describe, it, expect, vi } from 'vitest'

vi.mock('../db', () => ({ prisma: {} }))

import { evidenceImage, renderReviewCard, reviewCardsEnabled, syncReviewCard, syncReviewCardsFor, type ReviewCardDeps, type ReviewCardView } from './review-cards'

const APP = 'https://app.pizzadao.org'
const view = (over: Partial<ReviewCardView> = {}): ReviewCardView => ({
  id: 42,
  discordId: '100000000000000002',
  status: 'PENDING',
  holdReason: null,
  level: 3,
  index: 0,
  title: 'Share your community in #show-and-tell',
  evidence: 'https://discord.com/channels/1/2/3',
  attempts: 2,
  submittedAt: new Date('2026-10-01T00:00:00Z'),
  queuedAt: new Date('2026-10-01T00:00:00Z'),
  reviewedBy: null,
  reviewedAt: null,
  reviewNote: null,
  decision: null,
  checkResult: null,
  reviewMsgId: null,
  reviewChannelId: null,
  reviewCardAt: null,
  signals: [],
  flags: [],
  ...over,
})

type Btn = { label: string; custom_id?: string; url?: string; disabled?: boolean; style: number }
const buttons = (msg: ReturnType<typeof renderReviewCard>) => (msg.components[0] as { components: Btn[] }).components

describe('renderReviewCard', () => {
  it('a pending submission: amber card with member, level and mission, evidence, attempts and live buttons', () => {
    const msg = renderReviewCard(view(), { appUrl: APP })
    const e = msg.embeds[0]
    expect(e.color).toBe(0xf39c12)
    expect(e.description).toMatch(/^⏳ Needs review: L3\.0 · Share your community/)
    expect(e.description).toContain('<@100000000000000002> · Level 3 · attempt 2 of 3')
    expect(e.fields?.find((f) => f.name === 'Evidence')?.value).toBe('[discord.com/channels/1/2/3](<https://discord.com/channels/1/2/3>)')
    expect(e.footer?.text).toContain('#42')
    expect(msg.allowed_mentions).toEqual({ parse: [] })
    expect(buttons(msg).map((b) => [b.label, b.custom_id ?? b.url, !!b.disabled])).toEqual([
      ['Approve', 'mr:approve:42', false],
      ['Reject', 'mr:reject:42', false],
      ['Open in app', `${APP}/missions`, false],
    ])
  })

  it('a semi-automatic pre-check (Phase 4): summary, ✅ / ❌ / 👀 lines, confidence, and the preview as thumbnail', () => {
    const msg = renderReviewCard(
      view({
        level: 2,
        title: 'Post about PizzaDAO',
        evidence: 'https://x.com/pizzafan/status/1844000000000000001',
        checkResult: {
          verifier: 'social_post',
          summary: 'X post by @pizzafan',
          confidence: 'medium',
          checks: [
            { label: 'X post link', ok: true },
            { label: 'Link is under @someone; linked X is @pizzafan', ok: false },
            { label: 'Engagement: check by eye', ok: null },
          ],
          data: { platform: 'x' },
          preview: { url: 'https://x.com/pizzafan/status/1844000000000000001', kind: 'page', image: 'https://pbs.twimg.com/card.jpg' },
        },
      }),
      { appUrl: APP },
    )
    const e = msg.embeds[0]
    const saw = e.fields?.find((f) => f.name === 'Verifier saw')?.value ?? ''
    expect(saw.split('\n')).toEqual([
      '**X post by @\u200bpizzafan**',
      '✅ X post link',
      '❌ Link is under @\u200bsomeone; linked X is @\u200bpizzafan',
      '👀 Engagement: check by eye',
      'Confidence: 🟡 some things need your eye',
    ])
    expect(e.thumbnail).toEqual({ url: 'https://pbs.twimg.com/card.jpg' })
    expect(e.image).toBeUndefined()
  })

  it('an auto-hold: Release instead of Approve, the hold reason and what the verifier saw', () => {
    const msg = renderReviewCard(view({ level: 6, holdReason: 'HIGH_LEVEL', checkResult: { roleIds: ['823266914834841610'], handle: 'x_y' } }), { appUrl: APP })
    const e = msg.embeds[0]
    expect(e.description).toMatch(/Auto-verified, awaiting release: L6\.0/)
    expect(e.fields?.find((f) => f.name === 'Release needed')?.value).toMatch(/Level 6\+/)
    expect(e.fields?.find((f) => f.name === 'Verifier saw')?.value).toContain('handle: x\\_y')
    expect(buttons(msg)[0]).toMatchObject({ label: 'Release', custom_id: 'mr:release:42' })
  })

  it('duplicate-account signals and flags are shown', () => {
    const msg = renderReviewCard(
      view({
        signals: [{ kind: 'shared_wallet', label: 'Shares a wallet with', key: '0xabc', others: ['100000000000000003'] }],
        flags: [{ level: 6, index: 0, title: 'Join Pepperoni Mafia', reason: 'role removed' }],
      }),
      { appUrl: APP },
    )
    const f = msg.embeds[0].fields!
    expect(f.find((x) => x.name === 'Duplicate-account signals')?.value).toBe('⚠️ Shares a wallet with <@100000000000000003>')
    expect(f.find((x) => x.name === 'Flagged completions')?.value).toBe('🚩 L6.0 · Join Pepperoni Mafia: role removed')
  })

  it('image evidence is previewed; text evidence is escaped and cannot ping', () => {
    expect(renderReviewCard(view({ evidence: 'https://x.public.blob.vercel-storage.com/a' }), { appUrl: APP }).embeds[0].image).toEqual({
      url: 'https://x.public.blob.vercel-storage.com/a',
    })
    expect(evidenceImage('https://i.imgur.com/a.PNG')).toBe('https://i.imgur.com/a.PNG')
    expect(evidenceImage('http://i.imgur.com/a.png')).toBeNull()
    expect(evidenceImage('https://x.com/status/1')).toBeNull()
    const e = renderReviewCard(view({ evidence: 'I did it @everyone **bold**' }), { appUrl: APP }).embeds[0]
    expect(e.fields?.[0].value).toBe('I did it @​everyone \\*\\*bold\\*\\*')
  })

  it('approved: green, who and when, buttons disabled', () => {
    const at = new Date('2026-10-02T10:00:00Z')
    const msg = renderReviewCard(view({ status: 'APPROVED', reviewedBy: '100000000000000001', reviewedAt: at, decision: 'APPROVED' }), { appUrl: APP })
    const e = msg.embeds[0]
    expect(e.color).toBe(0x2ecc71)
    expect(e.description).toMatch(/^✅ Approved: L3\.0/)
    expect(e.description).toContain(`✅ Approved by <@100000000000000001> · <t:${at.getTime() / 1000}:f>`)
    expect(buttons(msg).filter((b) => b.custom_id).every((b) => b.disabled)).toBe(true)
    expect(buttons(msg).find((b) => b.url)?.disabled).toBeUndefined()
  })

  it('released and rejected cards say so; the reject reason is shown', () => {
    const rel = renderReviewCard(view({ status: 'APPROVED', reviewedBy: '100000000000000001', reviewedAt: new Date(), decision: 'RELEASED' }), { appUrl: APP })
    expect(rel.embeds[0].description).toMatch(/Released by <@100000000000000001>/)
    const rej = renderReviewCard(view({ status: 'REJECTED', reviewedBy: '100000000000000001', reviewedAt: new Date(), reviewNote: 'Not your post', decision: 'REJECTED' }), { appUrl: APP })
    expect(rej.embeds[0].color).toBe(0xe74c3c)
    expect(rej.embeds[0].description).toMatch(/❌ Rejected by <@100000000000000001>/)
    expect(rej.embeds[0].fields?.find((f) => f.name === 'Reason')?.value).toBe('Not your post')
    const auto = renderReviewCard(view({ status: 'APPROVED', reviewedBy: 'auto:discord_message', reviewedAt: new Date() }), { appUrl: APP })
    expect(auto.embeds[0].description).toMatch(/Verified automatically/)
  })
})

describe('reviewCardsEnabled', () => {
  it('is off by default', () => {
    expect(reviewCardsEnabled({} as unknown as NodeJS.ProcessEnv)).toBe(false)
    expect(reviewCardsEnabled({ MISSION_REVIEW_CARDS_ENABLED: '0' } as unknown as NodeJS.ProcessEnv)).toBe(false)
    expect(reviewCardsEnabled({ MISSION_REVIEW_CARDS_ENABLED: '1' } as unknown as NodeJS.ProcessEnv)).toBe(true)
    expect(reviewCardsEnabled({ MISSION_REVIEW_CARDS_ENABLED: 'true' } as unknown as NodeJS.ProcessEnv)).toBe(true)
  })
})

function makeDeps(rows: ReviewCardView[], over: Partial<ReviewCardDeps> = {}) {
  let i = 0
  const d = {
    enabled: () => true,
    load: vi.fn(async () => rows[Math.min(i++, rows.length - 1)] ?? null),
    claim: vi.fn(async () => true),
    unclaim: vi.fn(async () => undefined),
    store: vi.fn(async () => undefined),
    idsFor: vi.fn(async () => [42]),
    resolveChannel: vi.fn(async () => '200000000000000001'),
    post: vi.fn(async () => ({ id: '300000000000000001' })),
    edit: vi.fn(async () => undefined),
    appUrl: () => APP,
    ...over,
  }
  return d
}

describe('syncReviewCard', () => {
  it('disabled: does nothing at all', async () => {
    const d = makeDeps([view()], { enabled: () => false })
    expect(await syncReviewCard(42, d)).toBe('disabled')
    expect(d.load).not.toHaveBeenCalled()
  })

  it('a pending submission without a card: claim, post in #work, store the message id and channel', async () => {
    const d = makeDeps([view(), view()])
    expect(await syncReviewCard(42, d)).toBe('posted')
    expect(d.claim).toHaveBeenCalledWith(42, expect.any(Date))
    expect(d.post).toHaveBeenCalledWith('200000000000000001', expect.objectContaining({ allowed_mentions: { parse: [] } }))
    expect(d.store).toHaveBeenCalledWith(42, { channelId: '200000000000000001', messageId: '300000000000000001' })
    expect(d.edit).not.toHaveBeenCalled()
  })

  it('a lost claim (another sync is posting) posts nothing', async () => {
    const d = makeDeps([view()], { claim: vi.fn(async () => false) })
    expect(await syncReviewCard(42, d)).toBe('claimed_elsewhere')
    expect(d.post).not.toHaveBeenCalled()
  })

  it('a failed post releases the claim so a later sync can retry', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const d = makeDeps([view()], { post: vi.fn(async () => Promise.reject(new Error('Discord 500'))) })
    expect(await syncReviewCard(42, d)).toBe('failed')
    expect(d.unclaim).toHaveBeenCalledWith(42)
    expect(d.store).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('no #work channel: releases the claim', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const d = makeDeps([view()], { resolveChannel: vi.fn(async () => null) })
    expect(await syncReviewCard(42, d)).toBe('no_channel')
    expect(d.unclaim).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('decided while the card was being posted: the fresh state is edited in', async () => {
    const d = makeDeps([view(), view({ status: 'APPROVED', reviewedBy: '100000000000000001', reviewedAt: new Date() })])
    expect(await syncReviewCard(42, d)).toBe('posted')
    expect(d.edit).toHaveBeenCalledTimes(1)
    expect(vi.mocked(d.edit).mock.calls[0][1].embeds[0].description).toMatch(/^✅ Approved/)
  })

  it('an existing card is edited in place, never posted again', async () => {
    const d = makeDeps([view({ status: 'REJECTED', reviewedBy: '1', reviewedAt: new Date(), reviewMsgId: '300000000000000009', reviewChannelId: '200000000000000009' })])
    expect(await syncReviewCard(42, d)).toBe('edited')
    expect(d.edit).toHaveBeenCalledWith({ channelId: '200000000000000009', messageId: '300000000000000009' }, expect.anything())
    expect(d.post).not.toHaveBeenCalled()
    expect(d.claim).not.toHaveBeenCalled()
  })

  it('a decided row without a card needs none', async () => {
    const d = makeDeps([view({ status: 'APPROVED', reviewedBy: 'auto:x_linked', reviewedAt: new Date() })])
    expect(await syncReviewCard(42, d)).toBe('no_card_needed')
    expect(d.post).not.toHaveBeenCalled()
  })

  it('the card an interaction came from is adopted when its id was never stored', async () => {
    const hint = { channelId: '200000000000000005', messageId: '300000000000000005' }
    const d = makeDeps([view({ status: 'APPROVED', reviewedBy: '1', reviewedAt: new Date() })])
    expect(await syncReviewCard(42, d, hint)).toBe('edited')
    expect(d.store).toHaveBeenCalledWith(42, hint)
    expect(d.edit).toHaveBeenCalledWith(hint, expect.anything())
  })

  it('syncReviewCardsFor syncs each of the member’s completions for those missions', async () => {
    const d = makeDeps([view()], { idsFor: vi.fn(async () => [42, 43]) })
    expect(await syncReviewCardsFor('100000000000000002', [7, 7, 8], d)).toHaveLength(2)
    expect(d.idsFor).toHaveBeenCalledWith('100000000000000002', [7, 8])
    expect(await syncReviewCardsFor('100000000000000002', [7], { ...d, enabled: () => false })).toEqual([])
  })
})
