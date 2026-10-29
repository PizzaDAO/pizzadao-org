// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { chooseLane, isHighRisk, requiredAyes, slaHoursFor } from './lane'
import { policy } from './test-utils'
import type { PaymentFlag } from './types'

const f = (over: Partial<PaymentFlag> = {}): PaymentFlag => ({ id: 'x', severity: 'medium', detail: '', source: 'rules', ...over })
const base = { amountUsd: 200, riskScore: 0, flags: [] as PaymentFlag[], fastEligible: false }

describe('chooseLane', () => {
  it('standard by default, with one approval', () => {
    expect(chooseLane(base, policy())).toEqual({ lane: 'STANDARD', approvalsNeeded: 1 })
  })
  it('fast only when eligible, switched on, small, low risk and with no high flag', () => {
    const fast = policy({ fastTrackEnabled: true })
    const eligible = { ...base, fastEligible: true }
    expect(chooseLane(eligible, fast).lane).toBe('FAST')
    expect(chooseLane(eligible, policy()).lane).toBe('STANDARD')
    expect(chooseLane({ ...eligible, amountUsd: 500 }, policy({ fastTrackEnabled: true, fastTrackMaxUsd: 300 })).lane).toBe('STANDARD')
    expect(chooseLane({ ...eligible, riskScore: 11 }, fast).lane).toBe('STANDARD')
    expect(chooseLane({ ...eligible, riskScore: 10 }, fast).lane).toBe('FAST')
    expect(chooseLane({ ...eligible, flags: [f({ severity: 'high' })] }, fast).lane).toBe('STANDARD')
    expect(chooseLane({ ...eligible, fastEligible: false }, fast).lane).toBe('STANDARD')
  })
  it('any AI flag removes the fast lane, and AI flags do not need to be counted in the score to do it', () => {
    const fast = policy({ fastTrackEnabled: true })
    const ai = f({ source: 'ai', severity: 'low' })
    expect(chooseLane({ ...base, fastEligible: true, flags: [ai] }, fast).lane).toBe('STANDARD')
    // The score passed in is rules-only, so AI flags alone can never reach the high-risk lane.
    expect(chooseLane({ ...base, fastEligible: true, riskScore: 0, flags: [ai, ai, ai] }, fast).lane).toBe('STANDARD')
  })
  it('a degraded policy can never produce FAST', () => {
    expect(chooseLane({ ...base, fastEligible: true }, policy({ fastTrackEnabled: true, degraded: true })).lane).toBe('STANDARD')
  })
  it('over the cap needs a vote; the failure value of the cap (0) sends everything there', () => {
    expect(chooseLane({ ...base, amountUsd: 626 }, policy()).lane).toBe('VOTE_REQUIRED')
    expect(chooseLane(base, policy({ onApprovalCapUsd: 0 })).lane).toBe('VOTE_REQUIRED')
  })
  it('risk at or above the score, or a hard block, is high risk with more approvals', () => {
    expect(chooseLane({ ...base, riskScore: 50 }, policy())).toEqual({ lane: 'HIGH_RISK', approvalsNeeded: 2 })
    expect(chooseLane({ ...base, riskScore: 49 }, policy()).lane).toBe('STANDARD')
    expect(chooseLane({ ...base, flags: [f({ hardBlock: true })] }, policy({ highRiskApprovals: 3 }))).toEqual({ lane: 'HIGH_RISK', approvalsNeeded: 3 })
  })
  it('risk rules still apply on top of a vote', () => {
    expect(chooseLane({ ...base, amountUsd: 900, riskScore: 60 }, policy())).toEqual({ lane: 'VOTE_REQUIRED', approvalsNeeded: 2 })
  })
  it('isHighRisk', () => {
    expect(isHighRisk(0, [f({ hardBlock: true })], policy())).toBe(true)
    expect(isHighRisk(49, [], policy())).toBe(false)
  })
})

describe('tiers and sla', () => {
  it('picks the aye tier by amount', () => {
    const p = policy()
    expect(requiredAyes(300, p)).toBe(15)
    expect(requiredAyes(700, p)).toBe(25)
    expect(requiredAyes(2500, p)).toBe(25)
    expect(requiredAyes(2501, p)).toBe(35)
  })
  it('fast has the short target', () => {
    expect(slaHoursFor('FAST', policy())).toBe(24)
    expect(slaHoursFor('STANDARD', policy())).toBe(72)
  })
})
