// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { buddyCapacity, buildChecklist, checkPairing, hasTraineeFinished, isActiveStatus, isBuddyEligible, renderIntro, threadName, type PairingFacts } from './rules'

const ok: PairingFacts = {
  traineeDiscordId: '111111',
  buddyDiscordId: '222222',
  buddy: { active: true, paused: false, maxActive: 2 },
  buddyActiveCount: 0,
  traineeActiveCount: 0,
  traineeFinished: false,
  capacityCap: 2,
}

describe('eligibility', () => {
  it('needs the configured minimum level', () => {
    expect(isBuddyEligible(3, 4)).toBe(false)
    expect(isBuddyEligible(4, 4)).toBe(true)
    expect(isBuddyEligible(9, 4)).toBe(true)
    expect(isBuddyEligible(5, 6)).toBe(false)
    expect(isBuddyEligible(Number.NaN, 4)).toBe(false)
  })
})

describe('pairing constraints', () => {
  it('allows a clean pair', () => expect(checkPairing(ok)).toBeNull())
  it('refuses self, unknown, opted-out and paused buddies', () => {
    expect(checkPairing({ ...ok, buddyDiscordId: ok.traineeDiscordId })).toBe('self')
    expect(checkPairing({ ...ok, buddy: null })).toBe('buddy_unavailable')
    expect(checkPairing({ ...ok, buddy: { ...ok.buddy!, active: false } })).toBe('buddy_unavailable')
    expect(checkPairing({ ...ok, buddy: { ...ok.buddy!, paused: true } })).toBe('buddy_paused')
  })
  it('allows one active buddy per trainee', () => {
    expect(checkPairing({ ...ok, traineeActiveCount: 1 })).toBe('trainee_has_buddy')
  })
  it('refuses a trainee who already finished', () => {
    expect(checkPairing({ ...ok, traineeFinished: true })).toBe('trainee_finished')
  })
  it('caps a buddy at their own limit and at the setting', () => {
    expect(checkPairing({ ...ok, buddyActiveCount: 1 })).toBeNull()
    expect(checkPairing({ ...ok, buddyActiveCount: 2 })).toBe('buddy_full')
    // The buddy asked for 5 but the site cap is 2.
    expect(checkPairing({ ...ok, buddy: { ...ok.buddy!, maxActive: 5 }, buddyActiveCount: 2 })).toBe('buddy_full')
    // The buddy asked for 1 although the cap is 3.
    expect(checkPairing({ ...ok, buddy: { ...ok.buddy!, maxActive: 1 }, capacityCap: 3, buddyActiveCount: 1 })).toBe('buddy_full')
  })
  it('capacity is at least one', () => {
    expect(buddyCapacity(0, 2)).toBe(1)
    expect(buddyCapacity(5, 3)).toBe(3)
    expect(buddyCapacity(2, 3)).toBe(2)
  })
  it('counts QUEUED, MATCHED and INTRODUCED as active', () => {
    for (const s of ['QUEUED', 'MATCHED', 'INTRODUCED']) expect(isActiveStatus(s)).toBe(true)
    for (const s of ['COMPLETED', 'ENDED', 'EXPIRED', 'DECLINED']) expect(isActiveStatus(s)).toBe(false)
  })
})

describe('completion detection', () => {
  it('is done once the trainee has completed the configured level', () => {
    expect(hasTraineeFinished(1, 2)).toBe(false)
    expect(hasTraineeFinished(2, 2)).toBe(false) // still working on level 2
    expect(hasTraineeFinished(3, 2)).toBe(true)
    expect(hasTraineeFinished(3, 3)).toBe(false)
  })
})

describe('checklist', () => {
  const base = { introduced: false, traineeLevel: 1, completionLevel: 2, traineeCalls: 0, vouched: false }
  it('ticks nothing for a fresh pair', () => {
    const items = buildChecklist(base)
    expect(items.map((i) => i.key)).toEqual(['intro', 'call', 'level1', 'level2', 'vouch'])
    expect(items.every((i) => !i.done)).toBe(true)
  })
  it('ticks from existing mission, attendance and vouch data', () => {
    const items = buildChecklist({ introduced: true, traineeLevel: 2, completionLevel: 2, traineeCalls: 1, vouched: true })
    const done = Object.fromEntries(items.map((i) => [i.key, i.done]))
    expect(done).toEqual({ intro: true, call: true, level1: true, level2: false, vouch: true })
  })
})

describe('intro text', () => {
  it('fills both mentions', () => {
    expect(renderIntro('Hi {trainee}, meet {buddy}. {buddy}!', { traineeDiscordId: '1', buddyDiscordId: '2' })).toBe('Hi <@1>, meet <@2>. <@2>!')
  })
  it('thread names carry no mentions or newlines and fit Discord', () => {
    expect(threadName('Mario\n@everyone <b>')).toBe('Buddy: Mario everyone b')
    expect(threadName('')).toBe('Buddy: new member')
    expect(threadName('x'.repeat(300)).length).toBe(100)
  })
})
