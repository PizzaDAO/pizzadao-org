import { describe, it, expect } from 'vitest'
import type { FollowUpStatus } from '@prisma/client'
import { canTransition, EDITABLE, OPEN_AFTER_SEND, TRANSITIONS } from './state'

describe('follow-up state machine', () => {
  it('a draft can only be approved or dismissed (never sent directly)', () => {
    expect(TRANSITIONS.DRAFT).toEqual(['APPROVED', 'DISMISSED'])
    expect(canTransition('DRAFT', 'SENT')).toBe(false)
    expect(canTransition('DRAFT', 'ESCALATED')).toBe(false)
  })
  it('SENT is reachable only from APPROVED', () => {
    const all = Object.keys(TRANSITIONS) as FollowUpStatus[]
    expect(all.filter((s) => canTransition(s, 'SENT'))).toEqual(['APPROVED'])
  })
  it('APPROVED is reachable only from reviewer-editable states', () => {
    const all = Object.keys(TRANSITIONS) as FollowUpStatus[]
    expect(all.filter((s) => canTransition(s, 'APPROVED')).sort()).toEqual(['DRAFT', 'FAILED', 'UNREACHABLE'])
    for (const s of EDITABLE) expect(canTransition(s, 'APPROVED')).toBe(true)
  })
  it('an unreachable row can be escalated, and an escalated one only dismissed', () => {
    expect(canTransition('UNREACHABLE', 'ESCALATED')).toBe(true)
    expect(TRANSITIONS.ESCALATED).toEqual(['DISMISSED'])
  })
  it('the member can answer after a send, in any order', () => {
    for (const s of OPEN_AFTER_SEND) {
      for (const to of ['REPLIED', 'IN_PROGRESS', 'NEEDS_HELP', 'DONE'] as const) expect(canTransition(s, to)).toBe(true)
    }
  })
  it('DONE and DISMISSED are final', () => {
    expect(TRANSITIONS.DONE).toEqual([])
    expect(TRANSITIONS.DISMISSED).toEqual([])
    expect(canTransition('DISMISSED', 'APPROVED')).toBe(false)
  })
})
