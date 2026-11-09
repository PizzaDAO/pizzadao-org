// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { Settings } from '@/app/lib/settings'
import { SETTINGS, type SettingKey } from '@/app/lib/settings/registry'
import {
  chatItemText,
  cleanItemText,
  cleanOwner,
  formatConfirmation,
  isSameItem,
  liveConfigFrom,
  liveRequestSchema,
  mergeLiveActionItems,
  normKey,
  parseCrewList,
} from './live-items'

function fakeSettings(over: Partial<Record<SettingKey, unknown>> = {}, readFailed = false): Settings {
  return {
    readFailed,
    invalidKeys: [],
    isSet: (k) => k in over,
    get: ((k: SettingKey) => (k in over ? over[k] : SETTINGS[k].default)) as Settings['get'],
  }
}
const PROD = { VERCEL_ENV: 'production' }

describe('liveConfigFrom', () => {
  it('is all off by default (switches off, no crews)', () => {
    const c = liveConfigFrom(fakeSettings(), PROD)
    expect(c.audio).toBe(false)
    expect(c.chat).toBe(false)
    expect(c.crews).toEqual([])
    expect(c.prefixes).toEqual(['action:', 'ai:', 'todo:'])
  })
  it('a switch alone does nothing without a crew on the allowlist', () => {
    expect(liveConfigFrom(fakeSettings({ 'calls.liveActionItemsEnabled': true, 'calls.chatActionItemsEnabled': true }), PROD)).toMatchObject({ audio: false, chat: false })
  })
  it('turns on with a saved switch and a crew, in production only', () => {
    const s = fakeSettings({ 'calls.liveActionItemsEnabled': true, 'calls.chatActionItemsEnabled': true, 'calls.liveActionItemsCrews': 'Ops, test-crew' })
    expect(liveConfigFrom(s, PROD)).toMatchObject({ audio: true, chat: true, crews: ['ops', 'test_crew'] })
    expect(liveConfigFrom(s, { VERCEL_ENV: 'preview' })).toMatchObject({ audio: false, chat: false })
    expect(liveConfigFrom(s, { ...PROD, CALL_LIVE_ACTION_ITEMS_ENABLED: 'off' })).toMatchObject({ audio: false, chat: true })
  })
  it('is off when the settings cannot be read', () => {
    const s = fakeSettings({ 'calls.liveActionItemsEnabled': true, 'calls.liveActionItemsCrews': 'ops' }, true)
    expect(liveConfigFrom(s, PROD)).toMatchObject({ audio: false, chat: false, crews: [] })
  })
})

describe('text helpers', () => {
  it('chatItemText matches prefixes like the recorder', () => {
    expect(chatItemText('AI: send the deck', ['action:', 'ai:'])).toBe('send the deck')
    expect(chatItemText('said: ai: no', ['ai:'])).toBeNull()
    expect(chatItemText('todo:', ['todo:'])).toBeNull()
  })
  it('cleanItemText makes one safe line', () => {
    expect(cleanItemText('# Book\n the  venue.')).toBe('Book the venue')
    expect(cleanItemText('-# small')).toBe('small')
    expect(cleanItemText('x'.repeat(300)).length).toBe(200)
  })
  it('cleanOwner keeps names only', () => {
    expect(cleanOwner('S2 (Ann)')).toBe('Ann')
    expect(cleanOwner('S2')).toBeNull()
    expect(cleanOwner('Speaker 3')).toBeNull()
    expect(cleanOwner('null')).toBeNull()
    expect(cleanOwner(null)).toBeNull()
    expect(cleanOwner('Bob')).toBe('Bob')
  })
  it('isSameItem catches rewordings', () => {
    expect(isSameItem('Book the venue', 'book venue')).toBe(true)
    expect(isSameItem('Book the venue for Friday', 'Book venue')).toBe(true)
    expect(isSameItem('Send the deck to the team', 'Send deck to team.')).toBe(true)
    expect(isSameItem('Book the venue', 'Send the deck')).toBe(false)
    expect(normKey('The Venue, booked!')).toBe('venue booked')
  })
  it('parseCrewList normalizes ids', () => {
    expect(parseCrewList(' Ops ,biz-dev,, ops')).toEqual(['ops', 'biz_dev'])
  })
})

describe('formatConfirmation', () => {
  it('one item: one line plus the small note', () => {
    expect(formatConfirmation([{ text: 'Book the venue', owner: 'Ann' }], 'Added to the call notes for review.')).toBe(
      '📝 Action item recorded: Book the venue — Ann\n-# Added to the call notes for review',
    )
  })
  it('several items: a short list, at most five; no note when empty', () => {
    const items = Array.from({ length: 7 }, (_, i) => ({ text: `Task ${i}`, owner: null }))
    const m = formatConfirmation(items, '')!
    expect(m.startsWith('📝 Action items recorded:\n• Task 0\n')).toBe(true)
    expect(m.split('\n')).toHaveLength(6)
  })
  it('nothing to say: null', () => {
    expect(formatConfirmation([], 'x')).toBeNull()
  })
})

describe('mergeLiveActionItems suggestedBy', () => {
  const seg = { discordId: '111', startMs: 10_000, endMs: 15_000, text: 'words' }
  const item = (speakerIds: string[]) => ({ text: 'Order stickers', owner: null, source: 'speech', messageId: null, speakerIds, startMs: 11_000, endMs: 14_000 })
  it('uses the first speaker display name', () => {
    expect(mergeLiveActionItems([], [item(['111'])], [seg], [], 30, { '111': 'Ann' })[0]).toEqual({ text: 'Order stickers', owner: null, suggestedBy: 'Ann' })
  })
  it('leaves it out without a name or with a generic fallback name', () => {
    expect(mergeLiveActionItems([], [item(['111'])], [seg], [])[0]).not.toHaveProperty('suggestedBy')
    expect(mergeLiveActionItems([], [item(['111'])], [seg], [], 30, { '111': 'Speaker 2' })[0]).not.toHaveProperty('suggestedBy')
  })
})

describe('mergeLiveActionItems', () => {
  const seg = (id: string) => ({ discordId: '111', startMs: 0, endMs: 0, text: 'action: x', kind: 'chat' as const, id })
  const speech = (discordId: string, startMs: number, endMs: number) => ({ discordId, startMs, endMs, text: 'words' })
  const spoken = (o: { speakerIds: string[]; startMs?: number | null; endMs?: number | null }) => ({ text: 'Order the banner stickers', owner: null, source: 'speech', messageId: null, ...o })
  it('drops a spoken item when no visible line of its speaker overlaps its span (hidden line, other speaker, or no span)', () => {
    const visible = [speech('111', 10_000, 15_000), speech('222', 40_000, 45_000)]
    const keep = (o: Parameters<typeof spoken>[0]) => mergeLiveActionItems([], [spoken(o)], visible, []).length === 1
    expect(keep({ speakerIds: ['111'], startMs: 11_000, endMs: 14_000 })).toBe(true)
    expect(keep({ speakerIds: ['111'], startMs: 16_000, endMs: 17_000 })).toBe(true) // within the slack
    expect(keep({ speakerIds: ['111'], startMs: 30_000, endMs: 33_000 })).toBe(false) // that line is hidden / gone
    expect(keep({ speakerIds: ['111'], startMs: 40_000, endMs: 45_000 })).toBe(false) // only someone else spoke then
    expect(keep({ speakerIds: ['111'], startMs: null, endMs: null })).toBe(false)
    expect(keep({ speakerIds: [], startMs: 11_000, endMs: 14_000 })).toBe(false)
    expect(keep({ speakerIds: ['333', '111'], startMs: 11_000, endMs: 14_000 })).toBe(true)
  })
  it('adds live items the summary lacks, without duplicates', () => {
    const out = mergeLiveActionItems(
      [{ text: 'Book the venue', owner: 'Ann' }],
      [
        { text: 'book venue', owner: null, source: 'speech', speakerIds: ['111'], messageId: null, startMs: 1000, endMs: 4000 },
        { text: 'Send the deck', owner: 'Bob', source: 'speech', speakerIds: ['222'], messageId: null, startMs: 10_000, endMs: 12_000 },
      ],
      [speech('222', 9_000, 13_000)],
      [],
    )
    expect(out).toEqual([{ text: 'Book the venue', owner: 'Ann' }, { text: 'Send the deck', owner: 'Bob' }])
  })
  it('respects redactions: hidden speakers and gone chat lines', () => {
    const out = mergeLiveActionItems(
      [],
      [
        { text: 'Hidden speaker task', owner: null, source: 'speech', speakerIds: ['999'], messageId: null, startMs: 0, endMs: 10 },
        { text: 'Typed and kept', owner: null, source: 'chat', speakerIds: ['111'], messageId: '700000000000000001' },
        { text: 'Typed then deleted', owner: null, source: 'chat', speakerIds: ['111'], messageId: '700000000000000002' },
      ],
      [seg('c:700000000000000001')],
      ['999'],
    )
    expect(out).toEqual([{ text: 'Typed and kept', owner: null }])
  })
  it('caps the list', () => {
    const base = Array.from({ length: 30 }, (_, i) => ({ text: `Base ${i} item`, owner: null }))
    expect(mergeLiveActionItems(base, [{ text: 'Extra live task', owner: null, source: 'chat', speakerIds: [], messageId: '700000000000000001' }], [seg('c:700000000000000001')], [])).toHaveLength(30)
  })
})

describe('liveRequestSchema', () => {
  const base = { sessionId: 'evt1-1700000000000', eventId: '100000000000000001', eventName: 'Ops', startedAt: new Date(0).toISOString() }
  it('accepts live keys and rejects other R2 keys', () => {
    const seg = { discordId: '111111', displayName: 'Ann', startMs: 1, endMs: 2 }
    expect(liveRequestSchema.safeParse({ ...base, seq: 1, segments: [{ ...seg, key: 'calls/evt1-1700000000000/live/111111/1.ogg' }] }).success).toBe(true)
    expect(liveRequestSchema.safeParse({ ...base, seq: 1, segments: [{ ...seg, key: 'calls/evt1-1700000000000/tracks/111111.ogg' }] }).success).toBe(false)
    expect(liveRequestSchema.safeParse({ ...base, seq: 1, segments: [{ ...seg, key: 'calls/evt1-1700000000000/live/../x/1.ogg' }] }).success).toBe(false)
  })
})
