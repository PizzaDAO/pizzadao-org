// @vitest-environment node
// What the verifier saw, for humans: role / channel / member names instead of IDs.
import { describe, it, expect, vi } from 'vitest'
import { checkIds, describeCheck } from './check-labels'
import { loadReviewLabels, type ReviewLabelDeps } from './review-labels'
import type { PersonLabel, PersonRef } from '../people'

const MAFIA = '823266914834841610'
const names = {
  role: (id: string) => (id === MAFIA ? 'Pepperoni Mafia' : undefined),
  channel: (id: string) => (id === '900000000000000001' ? 'show-and-tell' : undefined),
  user: (id: string) => (id === '100000000000000009' ? 'Alice' : undefined),
}

describe('describeCheck', () => {
  it('role IDs become role names', () => {
    expect(describeCheck({ roleIds: [MAFIA] }, names)).toEqual([{ label: 'Roles', value: 'Pepperoni Mafia' }])
  })

  it('unknown roles / channels are still marked as such; people fall back to the ID', () => {
    expect(describeCheck({ roleIds: ['123456789012'], channelId: '223456789012', invitees: ['323456789012'] }, {})).toEqual([
      { label: 'Roles', value: 'role 123456789012' },
      { label: 'Channel', value: '#223456789012' },
      { label: 'Invited', value: '323456789012' },
    ])
  })

  it('channels, messages (a jump link) and invitees', () => {
    expect(
      describeCheck(
        { channelId: '900000000000000001', messageId: '900000000000000002', referrals: 2, invitees: ['100000000000000009', '100000000000000010'] },
        names,
        { guildId: '700000000000000000' },
      ),
    ).toEqual([
      { label: 'Channel', value: '#show-and-tell' },
      { label: 'Message', value: 'open in Discord', href: 'https://discord.com/channels/700000000000000000/900000000000000001/900000000000000002' },
      { label: 'Referrals', value: '2' },
      { label: 'Invited', value: 'Alice, 100000000000000010' },
    ])
  })

  it('plain values keep friendly labels; nested objects are left out', () => {
    expect(describeCheck({ xUsername: 'pizza', calls: 3, need: 2, byCrew: { ops: 3 } })).toEqual([
      { label: 'X', value: 'pizza' },
      { label: 'Calls', value: '3' },
      { label: 'Needed', value: '2' },
    ])
    expect(describeCheck(null)).toEqual([])
    expect(describeCheck(['x'])).toEqual([])
  })

  it('checkIds collects the IDs to resolve, by kind', () => {
    expect(checkIds({ roleIds: [MAFIA, MAFIA], channelId: '900000000000000001', messageId: '9', invitees: ['100000000000000009'] })).toEqual({
      roles: [MAFIA],
      channels: ['900000000000000001'],
      users: ['100000000000000009'],
    })
  })
})

describe('loadReviewLabels', () => {
  const deps = (over: Partial<ReviewLabelDeps> = {}): ReviewLabelDeps => ({
    resolvePeople: vi.fn(async (refs: PersonRef[]) => new Map<string, PersonLabel>(refs.map((r) => [r.discordId, { discordId: r.discordId, name: `name-${r.discordId}`, source: 'sheet' }]))),
    roles: vi.fn(async () => [{ id: MAFIA, name: 'Pepperoni Mafia' }]),
    channels: vi.fn(async () => []),
    guildId: () => null,
    ...over,
  })

  it('resolves the cached guild roles once, and only when a check has role IDs', async () => {
    const d = deps()
    const labels = await loadReviewLabels({ people: [{ discordId: 'a' }], checks: [{ roleIds: [MAFIA] }, null] }, d)
    expect(labels.describe({ roleIds: [MAFIA] })).toEqual([{ label: 'Roles', value: 'Pepperoni Mafia' }])
    expect(labels.person('a').name).toBe('name-a')
    expect(d.roles).toHaveBeenCalledTimes(1)
    expect(d.channels).not.toHaveBeenCalled()
  })

  it('invitees are resolved with the people; a failing role lookup leaves the ID', async () => {
    const d = deps({ roles: async () => { throw new Error('discord down') } })
    const labels = await loadReviewLabels({ people: [], checks: [{ roleIds: [MAFIA], invitees: ['100000000000000009'] }] }, d)
    expect(labels.describe({ roleIds: [MAFIA], invitees: ['100000000000000009'] })).toEqual([
      { label: 'Roles', value: `role ${MAFIA}` },
      { label: 'Invited', value: 'name-100000000000000009' },
    ])
    expect(labels.person('zzz')).toEqual({ discordId: 'zzz', name: 'zzz', source: 'id' })
  })
})
