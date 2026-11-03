// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { VERIFIERS, attendanceCount } from './verifiers'
import { socialPost } from './semi'
import type { VerifierSources, VerifyCtx } from './types'

function ctx(over: Partial<VerifierSources> = {}): VerifyCtx {
  return { discordId: 'd1', memberId: 'm1', trigger: 'on_demand', now: new Date('2026-11-03T00:00:00Z'), evidence: null, memo: new Map(), sources: over as VerifierSources }
}

describe.each([
  ['pizzeria_checkin', 'pizzeria_checkin', 1],
  ['passport_stamps', 'passport_stamp', 5],
  ['spotlight', 'spotlight_featured', 1],
  ['shop_purchase', 'shop_purchase', 1],
  ['bounty_or_job', 'bounty_or_job', 1],
  ['article_published', 'article_published', 1],
])('%s', (key, kind, defMin) => {
  const v = VERIFIERS[key]
  it('parses params with a default min and rejects bad ones', () => {
    expect(v.parse(undefined)).toEqual({ min: defMin })
    expect(v.parse({ min: 3 })).toEqual({ min: 3 })
    expect(() => v.parse({ min: 0 })).toThrow()
    expect(() => v.parse([])).toThrow()
  })
  it('passes at min, fails with progress below it', async () => {
    const countActivity = vi.fn(async () => defMin)
    expect(await v.check(ctx({ countActivity }), { min: defMin })).toMatchObject({ status: 'pass' })
    expect(countActivity).toHaveBeenCalledWith(kind, 'd1', 'm1')
    expect(await v.check(ctx({ countActivity: async () => defMin - 1 }), { min: defMin })).toMatchObject({ status: 'fail', progress: { have: defMin - 1, need: defMin } })
  })
  it('is unknown when the source is missing or throws', async () => {
    expect(await v.check(ctx(), { min: defMin })).toMatchObject({ status: 'unknown' })
    expect(await v.check(ctx({ countActivity: async () => { throw new Error('db') } }), { min: defMin })).toMatchObject({ status: 'unknown' })
  })
})

describe('social_linked', () => {
  const v = VERIFIERS.social_linked
  it('parses platforms', () => {
    expect(v.parse(undefined)).toEqual({ platforms: ['telegram', 'farcaster'] })
    expect(() => v.parse({ platforms: ['x'] })).toThrow(/platforms/)
  })
  it('passes with Telegram or Farcaster, fails with neither', async () => {
    const none = { getTelegramUsername: async () => null, getFarcasterAccounts: async () => [] }
    expect(await v.check(ctx(none), { platforms: ['telegram', 'farcaster'] })).toMatchObject({ status: 'fail' })
    expect(await v.check(ctx({ ...none, getTelegramUsername: async () => 'sam' }), { platforms: ['telegram', 'farcaster'] })).toMatchObject({ status: 'pass', evidence: { linked: ['telegram'] } })
    expect(await v.check(ctx({ ...none, getFarcasterAccounts: async () => [{ username: 'a', fid: 1 }] }), { platforms: ['farcaster'] })).toMatchObject({ status: 'pass' })
    expect(await v.check(ctx({ ...none, getTelegramUsername: async () => 'sam' }), { platforms: ['farcaster'] })).toMatchObject({ status: 'fail' })
  })
})

describe('attendance_count with a window and crew (call streak)', () => {
  const params = { min: 10, windowDays: 30, crewId: 'community_call' }
  it('parses and validates the extra params', () => {
    expect(attendanceCount.parse(params)).toEqual(params)
    expect(attendanceCount.parse({ min: 2 })).toEqual({ min: 2 })
    expect(() => attendanceCount.parse({ min: 1, windowDays: 0 })).toThrow()
    expect(() => attendanceCount.parse({ min: 1, crewId: 'Bad Slug!' })).toThrow(/crewId/)
  })
  it('asks the source for the window, and passes or fails on the count', async () => {
    const countCallsAttended = vi.fn(async () => ({ total: 10, calls: 10, byCrew: { community_call: 10 } }))
    expect(await attendanceCount.check(ctx({ countCallsAttended }), params)).toMatchObject({ status: 'pass' })
    expect(countCallsAttended).toHaveBeenCalledWith('d1', { sinceDays: 30, crewId: 'community_call', now: new Date('2026-11-03T00:00:00Z') })
    const r = await attendanceCount.check(ctx({ countCallsAttended: async () => ({ total: 4, calls: 4, byCrew: {} }) }), params)
    expect(r).toMatchObject({ status: 'fail', progress: { have: 4, need: 10 } })
  })
  it('without window/crew it calls the source exactly as before', async () => {
    const countCallsAttended = vi.fn(async () => ({ total: 1, calls: 1, byCrew: {} }))
    await attendanceCount.check(ctx({ countCallsAttended }), { min: 1 })
    expect(countCallsAttended).toHaveBeenCalledWith('d1')
  })
})

describe('social_post with a likes-only requirement (Comms ambassador)', () => {
  it('accepts minReplies 0', () => {
    expect(socialPost.parse({ minReplies: 0, minLikes: 25 })).toMatchObject({ minReplies: 0, minLikes: 25 })
    expect(() => socialPost.parse({ minReplies: -1 })).toThrow()
  })
})
