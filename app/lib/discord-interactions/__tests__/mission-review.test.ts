// @vitest-environment node
// Mission review card buttons + Reject modal (Phase 3), through handleInteraction
// with the real canReviewMission and injected data. Never reaches Discord or a DB.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../discord', () => ({ getUserRoles: vi.fn(async () => []) }))

import { handleInteraction, type HandlerDeps, type Interaction } from '../handle'
import type { MissionReviewDeps, ReviewTarget } from '../mission-review'
import { canReviewMission } from '../../mission-review-access'

const GUILD = '812097286003359764'
const REVIEWER = '100000000000000001'
const MEMBER = '100000000000000002'
const LEONARDO = '815269418305191946'
const DPR = '812131585327235113'
const CAPO = '839206162837798945'
const MAFIA = '823266914834841610'
const RANDOM = '999999999999999999'
const CARD = { id: '300000000000000001', channel_id: '200000000000000001' }

const target = (over: Partial<ReviewTarget> = {}): ReviewTarget => ({
  discordId: MEMBER,
  level: 3,
  status: 'PENDING',
  holdReason: null,
  reviewedBy: null,
  reviewedAt: null,
  ...over,
})

let current: ReviewTarget | null
let review: MissionReviewDeps
const decide = vi.fn<MissionReviewDeps['decide']>()
const refresh = vi.fn<NonNullable<MissionReviewDeps['refresh']>>()

beforeEach(() => {
  current = target()
  decide.mockReset()
  refresh.mockReset()
  review = {
    enabled: () => true,
    target: vi.fn(async () => current),
    canReview: (roles, level) => canReviewMission(roles, level),
    decide,
    refresh,
    appUrl: 'https://app.pizzadao.org',
  }
})

// Only what the review paths touch; everything else would throw if reached.
const deps = (): HandlerDeps => ({ guildId: GUILD, missionReview: review }) as unknown as HandlerDeps

const click = (customId: string, roles: string[], user = REVIEWER): Interaction => ({
  type: 3,
  application_id: 'app-1',
  token: 'tok-1',
  guild_id: GUILD,
  channel_id: CARD.channel_id,
  message: CARD,
  member: { user: { id: user }, roles },
  data: { custom_id: customId, component_type: 2 },
})

const modal = (customId: string, reason: string, roles: string[], user = REVIEWER): Interaction => ({
  type: 5,
  application_id: 'app-1',
  token: 'tok-1',
  guild_id: GUILD,
  message: CARD,
  member: { user: { id: user }, roles },
  data: { custom_id: customId, components: [{ type: 1, components: [{ type: 4, custom_id: 'reason', value: reason }] }] },
})

const text = (r: { data?: { embeds?: Array<{ description: string }> } }) => r.data?.embeds?.[0]?.description ?? ''

describe('review buttons: who may review (canReviewMission with member.roles)', () => {
  const cases: Array<[string, string[], number, boolean]> = [
    ['Leonardo', [LEONARDO], 1, true],
    ['Leonardo', [LEONARDO], 7, true],
    ['Leonardo', [LEONARDO], 8, false],
    ['Dread Pizza Roberts', [DPR], 1, true],
    ['Dread Pizza Roberts', [DPR], 7, true],
    ['Dread Pizza Roberts', [DPR], 8, true],
    ['Pizza Capo', [CAPO], 3, true],
    ['Pizza Capo', [CAPO], 8, false],
    ['Pepperoni Mafia', [MAFIA], 6, true],
    ['Pepperoni Mafia', [MAFIA], 8, false],
    ['a random role', [RANDOM], 1, false],
    ['no roles', [], 1, false],
  ]

  it.each(cases)('%s on a Level %i card: %s', async (_name, roles, level, allowed) => {
    current = target({ level })
    const res = await handleInteraction(click('mr:approve:42', roles), deps())
    if (allowed) {
      expect(res).toEqual({ type: 6 })
      expect(decide).toHaveBeenCalledWith({
        action: 'approve',
        completionId: 42,
        reviewerId: REVIEWER,
        reason: undefined,
        applicationId: 'app-1',
        token: 'tok-1',
        card: { channelId: CARD.channel_id, messageId: CARD.id },
      })
    } else {
      expect(res.type).toBe(4)
      expect(res.data?.flags).toBe(64)
      expect(text(res)).toMatch(new RegExp(`can't review Level ${level}`))
      if (level >= 8) expect(text(res)).toMatch(/Only Dread Pizza Roberts/)
      expect(decide).not.toHaveBeenCalled()
    }
  })

  it('the same gate guards Reject (no modal for non-reviewers) and Release', async () => {
    current = target({ level: 8 })
    const rej = await handleInteraction(click('mr:reject:42', [CAPO]), deps())
    expect(rej.type).toBe(4)
    current = target({ level: 6, holdReason: 'HIGH_LEVEL' })
    const rel = await handleInteraction(click('mr:release:42', [RANDOM]), deps())
    expect(rel.type).toBe(4)
    expect(decide).not.toHaveBeenCalled()
  })

  it('Release on a held card defers a release', async () => {
    current = target({ level: 6, holdReason: 'HIGH_LEVEL' })
    expect(await handleInteraction(click('mr:release:42', [CAPO]), deps())).toEqual({ type: 6 })
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ action: 'release', completionId: 42 }))
  })
})

describe('review buttons: refusals', () => {
  it('nobody reviews their own submission, whatever their roles', async () => {
    current = target({ discordId: REVIEWER })
    for (const id of ['mr:approve:42', 'mr:reject:42', 'mr:release:42']) {
      const res = await handleInteraction(click(id, [LEONARDO, DPR]), deps())
      expect(res.data?.flags).toBe(64)
      expect(text(res)).toMatch(/your own submission/)
    }
    const res = await handleInteraction(modal('mr:reject-modal:42', 'not good enough', [DPR]), deps())
    expect(text(res)).toMatch(/your own submission/)
    expect(decide).not.toHaveBeenCalled()
  })

  it('a card already decided answers "already handled by X" (ephemeral) and refreshes the card', async () => {
    current = target({ status: 'APPROVED', reviewedBy: '100000000000000077', reviewedAt: new Date(1_800_000_000_000) })
    const res = await handleInteraction(click('mr:approve:42', [DPR]), deps())
    expect(res.data?.flags).toBe(64)
    expect(text(res)).toMatch(/Already handled/)
    expect(text(res)).toMatch(/already approved by <@100000000000000077>/)
    expect(refresh).toHaveBeenCalledWith(42, { channelId: CARD.channel_id, messageId: CARD.id })
    expect(decide).not.toHaveBeenCalled()
  })

  it('a missing submission, a disabled feature and a foreign guild are refused', async () => {
    current = null
    expect(text(await handleInteraction(click('mr:approve:42', [DPR]), deps()))).toMatch(/no longer exists/)
    review.enabled = () => false
    expect(text(await handleInteraction(click('mr:approve:42', [DPR]), deps()))).toMatch(/turned off/)
    const foreign = { ...click('mr:approve:42', [DPR]), guild_id: '1' }
    expect(text(await handleInteraction(foreign, deps()))).toMatch(/only work in the PizzaDAO server/)
    expect(decide).not.toHaveBeenCalled()
  })

  it('malformed custom ids are unknown buttons', async () => {
    for (const id of ['mr:approve:x', 'mr:nuke:1', 'mr:approve:12345678901']) {
      expect(text(await handleInteraction(click(id, [DPR]), deps()))).toMatch(/Unknown button/)
    }
  })

  it('without the review deps wired, review buttons and modals are unknown', async () => {
    const bare = { guildId: GUILD } as unknown as HandlerDeps
    expect(text(await handleInteraction(click('mr:approve:42', [DPR]), bare))).toMatch(/Unknown button/)
    expect(text(await handleInteraction(modal('mr:reject-modal:42', 'nope nope', [DPR]), bare))).toMatch(/Unknown form/)
  })
})

describe('reject: modal flow', () => {
  it('Reject opens a modal asking for a reason (3 to 500 characters)', async () => {
    const res = await handleInteraction(click('mr:reject:42', [CAPO]), deps())
    expect(res.type).toBe(9)
    expect(res.data?.custom_id).toBe('mr:reject-modal:42')
    const input = (res.data?.components as Array<{ components: Array<Record<string, unknown>> }>)[0].components[0]
    expect(input).toMatchObject({ type: 4, custom_id: 'reason', min_length: 3, max_length: 500, required: true })
    expect(decide).not.toHaveBeenCalled()
  })

  it('submitting the modal defers an update and rejects with the reason', async () => {
    const res = await handleInteraction(modal('mr:reject-modal:42', '  Link is not your post  ', [CAPO]), deps())
    expect(res).toEqual({ type: 6 })
    expect(decide).toHaveBeenCalledWith({
      action: 'reject',
      completionId: 42,
      reviewerId: REVIEWER,
      reason: 'Link is not your post',
      applicationId: 'app-1',
      token: 'tok-1',
      card: { channelId: CARD.channel_id, messageId: CARD.id },
    })
  })

  it('a too-short reason is refused', async () => {
    const res = await handleInteraction(modal('mr:reject-modal:42', ' no ', [CAPO]), deps())
    expect(text(res)).toMatch(/at least 3 characters/)
    expect(decide).not.toHaveBeenCalled()
  })

  it('the modal submit re-checks everything (roles, state) before rejecting', async () => {
    expect(text(await handleInteraction(modal('mr:reject-modal:42', 'not valid', [RANDOM]), deps()))).toMatch(/can't review/)
    current = target({ status: 'REJECTED', reviewedBy: '100000000000000088', reviewedAt: new Date() })
    expect(text(await handleInteraction(modal('mr:reject-modal:42', 'not valid', [CAPO]), deps()))).toMatch(/already rejected by <@100000000000000088>/)
    expect(decide).not.toHaveBeenCalled()
  })
})
