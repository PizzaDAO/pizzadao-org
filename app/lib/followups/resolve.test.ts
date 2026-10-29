import { describe, it, expect } from 'vitest'
import { defaultChannel, editDistance, normalizeName, resolveOwner, type MemberRef } from './resolve'

const members: MemberRef[] = [
  { id: 'm1', name: 'Alpha Bravo', discordId: '111111' },
  { id: 'm2', name: 'Charlie Delta', discordId: '222222' },
  { id: 'm3', name: 'Echo Foxtrot', discordId: '333333' },
  { id: 'm4', name: 'Echo Foxtrott', discordId: '444444' },
  { id: 'm5', name: 'Golf Hotel', discordId: '' },
  { id: 'm6', name: 'Dup Name', discordId: '555555' },
  { id: 'm7', name: 'dup  name', discordId: '666666' },
]

describe('normalizeName', () => {
  it('folds case, accents and punctuation', () => {
    expect(normalizeName('  Álpha-Bravo!! ')).toBe('alpha bravo')
  })
})

describe('editDistance', () => {
  it('counts edits', () => {
    expect(editDistance('kitten', 'sitting')).toBe(3)
    expect(editDistance('', 'abc')).toBe(3)
    expect(editDistance('same', 'same')).toBe(0)
  })
})

describe('resolveOwner', () => {
  it('uses the speaker Discord id first', () => {
    const r = resolveOwner({ ownerName: 'Someone Else', speakerDiscordId: '222222' }, members)
    expect(r).toMatchObject({ status: 'resolved', discordId: '222222', memberId: 'm2', matchedBy: 'speaker' })
  })
  it('keeps a speaker that is not in the sheet', () => {
    const r = resolveOwner({ ownerName: 'x', speakerDiscordId: '999' }, members)
    expect(r).toMatchObject({ status: 'resolved', discordId: '999', memberId: null })
  })
  it('matches a name exactly, ignoring case and accents', () => {
    const r = resolveOwner({ ownerName: 'ALPHA bravo' }, members)
    expect(r).toMatchObject({ status: 'resolved', discordId: '111111', matchedBy: 'exact' })
  })
  it('matches a close spelling', () => {
    const r = resolveOwner({ ownerName: 'Charly Delta' }, members)
    expect(r).toMatchObject({ status: 'resolved', discordId: '222222', matchedBy: 'fuzzy' })
  })
  it('needs two words to match by words (one short word is not enough to guess)', () => {
    const r = resolveOwner({ ownerName: 'Alpha' }, members)
    expect(r.status).toBe('unresolved') // one short word is not enough to guess
    const r2 = resolveOwner({ ownerName: 'Bravo Alpha Extra' }, members)
    expect(r2).toMatchObject({ status: 'resolved', memberId: 'm1', matchedBy: 'fuzzy' })
  })
  it('never guesses between equally close names', () => {
    const r = resolveOwner({ ownerName: 'Echo Foxtrotx' }, members)
    expect(r.status).toBe('ambiguous')
    expect(r.discordId).toBeNull()
    expect(r.candidates.map((c) => c.memberId).sort()).toEqual(['m3', 'm4'])
  })
  it('flags two members with the same normalized name as ambiguous', () => {
    const r = resolveOwner({ ownerName: 'Dup Name' }, members)
    expect(r.status).toBe('ambiguous')
    expect(r.candidates).toHaveLength(2)
  })
  it('resolves a member without a Discord id to a null id (unreachable, not wrong)', () => {
    const r = resolveOwner({ ownerName: 'Golf Hotel' }, members)
    expect(r).toMatchObject({ status: 'resolved', memberId: 'm5', discordId: null })
  })
  it('is unresolved for an unknown or empty name', () => {
    expect(resolveOwner({ ownerName: 'Zulu Yankee' }, members).status).toBe('unresolved')
    expect(resolveOwner({ ownerName: '   ' }, members).status).toBe('unresolved')
  })
})

describe('defaultChannel', () => {
  it('prefers Telegram only when DMs are allowed', () => {
    expect(defaultChannel({ dmAllowed: true })).toBe('TELEGRAM')
    expect(defaultChannel({ dmAllowed: false })).toBe('DISCORD')
    expect(defaultChannel(null)).toBe('DISCORD')
  })
})
