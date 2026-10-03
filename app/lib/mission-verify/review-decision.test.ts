// @vitest-environment node
// The deferred half of a review-card decision (Phase 3), with injected deps.
import { describe, it, expect, vi } from 'vitest'
import { ConflictError } from '../errors/api-errors'
import { postEphemeralFollowup, runReviewDecision, type ReviewDecisionDeps, type ReviewDecisionJob } from './review-decision'

const CARD = { channelId: '200000000000000001', messageId: '300000000000000001' }
const job = (over: Partial<ReviewDecisionJob> = {}): ReviewDecisionJob => ({
  action: 'approve',
  completionId: 42,
  reviewerId: '100000000000000001',
  applicationId: 'app-1',
  token: 'tok-1',
  card: CARD,
  ...over,
})

function makeDeps(over: Partial<ReviewDecisionDeps> = {}) {
  const d = {
    approve: vi.fn(async () => ({ discordId: 'member-1', levelsPaid: [] as number[] })),
    reject: vi.fn(async () => ({ discordId: 'member-1' })),
    handledBy: vi.fn(async () => ({ status: 'APPROVED', reviewedBy: '100000000000000009', reviewedAt: new Date(1_800_000_000_000) })),
    syncCard: vi.fn(async () => 'edited'),
    announce: vi.fn(async () => undefined),
    invalidate: vi.fn(),
    followup: vi.fn(async () => undefined),
    ...over,
  }
  return d
}

describe('runReviewDecision', () => {
  it('approve: the web panel function, then the card edit, cache invalidation and level-up announcement', async () => {
    const d = makeDeps({ approve: vi.fn(async () => ({ discordId: 'member-1', levelsPaid: [3] })) })
    expect(await runReviewDecision(job(), d)).toBe('approved')
    expect(d.approve).toHaveBeenCalledWith('100000000000000001', 42)
    expect(d.syncCard).toHaveBeenCalledWith(42, CARD)
    expect(d.invalidate).toHaveBeenCalledWith('member-1')
    expect(d.announce).toHaveBeenCalledWith('member-1', [3])
    expect(d.followup).not.toHaveBeenCalled()
  })

  it('release goes through approve too (approveMission releases holds)', async () => {
    const d = makeDeps()
    expect(await runReviewDecision(job({ action: 'release' }), d)).toBe('approved')
    expect(d.approve).toHaveBeenCalledTimes(1)
    expect(d.announce).not.toHaveBeenCalled() // nothing paid
  })

  it('reject: passes the modal reason to the reject path and edits the card', async () => {
    const d = makeDeps()
    expect(await runReviewDecision(job({ action: 'reject', reason: ' blurry screenshot ' }), d)).toBe('rejected')
    expect(d.reject).toHaveBeenCalledWith('100000000000000001', 42, 'blurry screenshot')
    expect(d.approve).not.toHaveBeenCalled()
    expect(d.syncCard).toHaveBeenCalledWith(42, CARD)
  })

  it('concurrent approve clicks: exactly one wins, every other reviewer gets an ephemeral "already handled by X"', async () => {
    // Mirrors approveMission's conditional PENDING -> APPROVED update: the first call wins.
    let winner: string | null = null
    const approve = vi.fn(async (reviewerId: string) => {
      await new Promise((r) => setTimeout(r, Math.random() * 5))
      if (winner) throw new ConflictError('This submission has already been reviewed')
      winner = reviewerId
      return { discordId: 'member-1', levelsPaid: [2] }
    })
    const d = makeDeps({
      approve,
      handledBy: vi.fn(async () => ({ status: 'APPROVED', reviewedBy: winner, reviewedAt: new Date() })),
    })
    const reviewers = Array.from({ length: 8 }, (_, i) => `10000000000000010${i}`)
    const results = await Promise.all(reviewers.map((r) => runReviewDecision(job({ reviewerId: r }), d)))
    expect(results.filter((r) => r === 'approved')).toHaveLength(1)
    expect(results.filter((r) => r === 'already_handled')).toHaveLength(7)
    expect(d.announce).toHaveBeenCalledTimes(1) // the level-up is announced once
    expect(d.followup).toHaveBeenCalledTimes(7)
    for (const [app, token, embed] of vi.mocked(d.followup).mock.calls as unknown as Array<[string, string, { description: string; color: number }]>) {
      expect([app, token]).toEqual(['app-1', 'tok-1'])
      expect(embed.description).toMatch(/^❌ Already handled\./)
      expect(embed.description).toContain(`already approved by <@${winner}>`)
    }
    // Every click leaves the card showing the outcome.
    expect(d.syncCard).toHaveBeenCalledTimes(8)
  })

  it('an approve losing to a rejection on the web says so', async () => {
    const d = makeDeps({
      approve: vi.fn(async () => {
        throw new ConflictError('This submission has already been reviewed')
      }),
      handledBy: vi.fn(async () => ({ status: 'REJECTED', reviewedBy: '100000000000000055', reviewedAt: null })),
    })
    expect(await runReviewDecision(job(), d)).toBe('already_handled')
    const embed = (vi.mocked(d.followup).mock.calls[0] as unknown as [string, string, { description: string }])[2]
    expect(embed.description).toContain('already rejected by <@100000000000000055>')
  })

  it('an unexpected failure tells the reviewer nothing changed, and does not touch the card', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const d = makeDeps({
      approve: vi.fn(async () => {
        throw new Error('db down')
      }),
    })
    expect(await runReviewDecision(job(), d)).toBe('error')
    expect((vi.mocked(d.followup).mock.calls[0] as unknown as [string, string, { description: string }])[2].description).toMatch(/Nothing was changed/)
    expect(d.syncCard).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('postEphemeralFollowup', () => {
  it('POSTs an ephemeral, mention-free follow-up to the interaction webhook', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }))
    await postEphemeralFollowup('app 1', 'tok/1', { color: 1, description: 'x' }, fetchImpl as unknown as typeof fetch)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://discord.com/api/v10/webhooks/app%201/tok%2F1')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ embeds: [{ color: 1, description: 'x' }], flags: 64, allowed_mentions: { parse: [] } })
  })

  it('throws on a Discord error', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 404 }))
    await expect(postEphemeralFollowup('a', 't', { color: 1, description: 'x' }, fetchImpl as unknown as typeof fetch)).rejects.toThrow(/404/)
  })
})
