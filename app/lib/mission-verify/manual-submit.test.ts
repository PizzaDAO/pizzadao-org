import { describe, it, expect } from 'vitest'
import { acceptsManualSubmission } from './policy'

describe('acceptsManualSubmission', () => {
  it('refuses automatic verifiers that have nothing to submit (vouch received, Rare Pizza Box, roles, attendance)', () => {
    for (const verifierKey of ['vouch_received', 'rare_pizza_box', 'vouch_given', 'discord_role', 'attendance_count', 'x_linked']) {
      expect(acceptsManualSubmission({ verifierKey, proofKind: 'NONE' })).toBe(false)
    }
  })

  it('accepts missions with a proof to submit, semi-automatic and manual ones, and L3.1 referral', () => {
    expect(acceptsManualSubmission({ verifierKey: 'discord_message', proofKind: 'DISCORD_MESSAGE' })).toBe(true)
    expect(acceptsManualSubmission({ verifierKey: 'poap_drop', proofKind: 'URL' })).toBe(true)
    expect(acceptsManualSubmission({ verifierKey: 'manual', proofKind: 'NONE' })).toBe(true)
    expect(acceptsManualSubmission({ verifierKey: 'referral', proofKind: 'NONE' })).toBe(true)
    expect(acceptsManualSubmission({ verifierKey: null, proofKind: 'NONE' })).toBe(true)
  })
})
