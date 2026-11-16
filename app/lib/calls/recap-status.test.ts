// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/db')
vi.mock('@/app/lib/crew-mappings', () => ({ getCrewMappings: vi.fn(async () => ({ cached: true, crews: [] })) }))
vi.mock('@/app/lib/telegram/city-posts', () => ({ enqueueMirror: vi.fn(async () => ({ queued: 0, reason: 'error' })) }))
vi.mock('@/app/lib/discord-channels', () => ({ resolveChannelId: vi.fn(async () => null) }))

import { prisma } from '@/app/lib/db'
import { DiscordPostError } from '@/app/lib/discord-rest'
import { clearPostFilterCache } from './post-filters'
import { buildRecapParts, buildRecapText, repostRecap, type RecapInput, type RecapLimits, type RecapPeople } from './recap'
import type { ActionView } from './action-status'

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>
const base = 'https://example.org'
const LIMITS: RecapLimits = { bullets: 5, actions: 10, chars: 220, minBullets: 3 }
const sentence = (n: number, len: number) => `Sentence ${n} ${'w'.repeat(Math.max(0, len - 12))}.`
const summary = (count: number, len: number) => Array.from({ length: count }, (_, i) => sentence(i + 1, len)).join(' ')
const view = (state: ActionView['state'], url?: string): ActionView => ({ state, links: url ? [{ url, label: 'example.org' }] : [] })
const input = (over: Partial<RecapInput> = {}): RecapInput => ({
  id: 'abc123',
  title: 'Ops sync',
  crewLabel: 'Ops',
  summary: 'We reviewed the launch plan. The budget was approved. Ann will own the vendor list. Next call moves to Thursday.',
  actionItems: [{ text: 'Send the deck', owner: 'Ann' }, { text: 'Book the venue' }],
  chapters: [],
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  clearPostFilterCache()
  db.appSetting.findMany.mockResolvedValue([])
})

describe('live status off: the recap is exactly what it was', () => {
  const items = [
    { text: 'Open one', owner: 'Ann' },
    { text: 'Finished', owner: 'Ann', done: true, evidence: [{ url: 'https://github.com/org/repo/pull/308' }, { url: 'https://docs.example.org/plan' }] },
    { text: 'Solo', owner: 'Ann', suggestedBy: 'Ann', done: true },
    { text: 'Asked by Bob', suggestedBy: 'Bob' },
  ]
  const expected = [
    '**Ops Crew Recap: Ops sync**',
    '',
    '- We reviewed the launch plan.',
    '- The budget was approved.',
    '- Ann will own the vendor list.',
    '- Next call moves to Thursday.',
    '',
    '**Action items**',
    '- Open one (owner: Ann)',
    '✅ Finished (owner: Ann): [PR #308](<https://github.com/org/repo/pull/308>), [docs.example.org](<https://docs.example.org/plan>)',
    '✅ Solo (suggested and owned by Ann)',
    '- Asked by Bob (suggested by Bob)',
    '',
    'Full summary and transcript: https://example.org/calls/abc123',
  ].join('\n')

  it('matches the literal text of today', () => {
    expect(buildRecapText(input({ actionItems: items }), base)).toBe(expected)
  })

  it('a link-heavy recap still drops evidence links before items, as before', () => {
    const ev = [{ url: `https://example.org/${'a'.repeat(150)}` }, { url: `https://example.org/${'b'.repeat(150)}` }, { url: `https://example.org/${'c'.repeat(150)}` }]
    const many = Array.from({ length: 12 }, (_, i) => ({ text: `Item ${i} ${'x'.repeat(100)}`, done: true, evidence: ev }))
    const t = buildRecapText(input({ actionItems: many }), base, undefined, { bullets: 5, actions: 12, chars: 120 })
    expect(t.length).toBeLessThanOrEqual(2000)
    expect(t).not.toContain('example.org/aaaa')
  })
})

describe('live status on: markers and links', () => {
  it('one marker per state, the first link only, open items keep the dash', () => {
    const t = buildRecapText(
      input({
        actionItems: [{ text: 'Shipped' }, { text: 'Working' }, { text: 'Not started' }, { text: 'Done twice' }],
        actionViews: [view('done', 'https://github.com/o/r/pull/9'), view('in_progress'), view(null), { state: 'done', links: [{ url: 'https://example.org/a', label: 'example.org' }, { url: 'https://example.org/b', label: 'example.org' }] }],
      }),
      base,
      undefined,
      LIMITS,
    )
    expect(t).toContain('✅ Shipped: [example.org](<https://github.com/o/r/pull/9>)')
    expect(t).toContain('\u{1F504} Working\n')
    expect(t).toContain('- Not started\n')
    expect(t).toContain('✅ Done twice: [example.org](<https://example.org/a>)')
    expect(t).not.toContain('example.org/b')
  })

  it('views line up with the stored items even when an earlier item is hidden by the post filter', () => {
    const t = buildRecapText(
      input({ actionItems: [{ text: 'About secretproject' }, { text: 'Shown' }], actionViews: [view('done'), view('in_progress')] }),
      base,
      { excludedCrewIds: [], excludedCrewLabelTerms: [], blockedTerms: ['secretproject'] },
      LIMITS,
    )
    expect(t).toContain('\u{1F504} Shown')
    expect(t).not.toContain('secretproject')
  })

  it('a link over 200 characters is left out, the marker stays', () => {
    const t = buildRecapText(input({ actionItems: [{ text: 'Long' }], actionViews: [view('done', `https://example.org/${'a'.repeat(200)}`)] }), base, undefined, LIMITS)
    expect(t).toContain('✅ Long\n')
  })

  it('stays within 2000 characters and keeps the call link', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ text: `Item ${i} ${'x'.repeat(150)}` }))
    const views = items.map(() => view('done', `https://example.org/${'p'.repeat(150)}`))
    const t = buildRecapText(input({ summary: summary(5, 220), actionItems: items, actionViews: views }), base, undefined, LIMITS)
    expect(t.length).toBeLessThanOrEqual(2000)
    expect(t.endsWith('Full summary and transcript: https://example.org/calls/abc123')).toBe(true)
  })
})

describe('live status on: the fitter gives up bullets, then links, then items', () => {
  const bulletCount = (t: string) => t.split('\n').filter((l) => l.startsWith('- Sentence')).length
  const linkCount = (t: string) => (t.match(/\]\(</g) ?? []).length
  const markerCount = (t: string) => t.split('\n').filter((l) => /^(✅|\u{1F504}|- )(?!Sentence)/u.test(l) && !l.startsWith('- Sentence')).length
  const build = (n: number, textLen: number, urlLen: number, minBullets = 3) => {
    const items = Array.from({ length: n }, (_, i) => ({ text: `Item ${i} ${'x'.repeat(textLen)}` }))
    const views = items.map(() => view('done', `https://example.org/${'p'.repeat(urlLen)}`))
    return buildRecapText(input({ summary: summary(5, 200), actionItems: items, actionViews: views }), base, undefined, { ...LIMITS, minBullets })
  }

  it('fits as is: all bullets, all links', () => {
    const t = build(3, 40, 20)
    expect(bulletCount(t)).toBe(5)
    expect(linkCount(t)).toBe(3)
  })

  it('too long: bullets go first, from the end, but not below the floor', () => {
    const t = build(10, 40, 20)
    expect(t.length).toBeLessThanOrEqual(2000)
    expect(linkCount(t)).toBe(10)
    expect(bulletCount(t)).toBeLessThan(5)
    expect(bulletCount(t)).toBeGreaterThanOrEqual(3)
    // The bullets that stay are the first ones.
    expect(t).toContain('- Sentence 1 ')
    expect(t).not.toContain('- Sentence 5 ')
  })

  it('still too long at the floor: links go next, from the last item upward, markers stay', () => {
    const t = build(10, 90, 60)
    expect(t.length).toBeLessThanOrEqual(2000)
    expect(bulletCount(t)).toBe(3)
    expect(linkCount(t)).toBeGreaterThan(0)
    expect(linkCount(t)).toBeLessThan(10)
    const lines = t.split('\n').filter((l) => l.startsWith('✅'))
    expect(lines.length).toBe(10)
    // Links are kept for a leading run of items and dropped for the rest.
    const has = lines.map((l) => l.includes('](<'))
    expect(has.indexOf(false)).toBe(has.lastIndexOf(true) + 1)
  })

  it('last: whole items go with a "+N more" note, no links left', () => {
    const t = build(10, 200, 100)
    expect(t.length).toBeLessThanOrEqual(2000)
    expect(bulletCount(t)).toBe(3)
    expect(linkCount(t)).toBe(0)
    expect(t).toMatch(/\+\d+ more on the call page/)
    expect(markerCount(t)).toBeGreaterThan(0)
  })

  it('the floor is configurable', () => {
    expect(bulletCount(build(10, 40, 20, 5))).toBe(5)
    expect(bulletCount(build(10, 90, 60, 0))).toBeLessThan(3)
  })
})

describe('live status on: mentions and Telegram', () => {
  const ENZO = '111111111111111111'
  const people: RecapPeople = { speakers: [{ discordId: ENZO, displayName: 'Enzo Pepperoni' }], members: [] }

  it('only ids the recap inserted and that survived the trimming', () => {
    const rec = input({ summary: 'Enzo reviewed the plan. The budget was approved. Everything is on track.', actionItems: [{ text: 'Do it', owner: 'Enzo Pepperoni' }], actionViews: [view('in_progress')] })
    const parts = buildRecapParts(rec, base, undefined, LIMITS, people)
    expect([...parts.mentions.keys()]).toEqual([ENZO])
    expect(parts.text).toContain(`\u{1F504} Do it (owner: <@${ENZO}>)`)
    const plain = buildRecapParts(rec, base, undefined, LIMITS, people, false)
    expect(plain.text).not.toContain('<@')
    expect(plain.text).toContain('\u{1F504} Do it (owner: Enzo Pepperoni)')
    expect(plain.mentions.size).toBe(0)
  })

  it('a mention in a bullet that was dropped for length does not stay in the allowed list', () => {
    const long = Array.from({ length: 10 }, (_, i) => ({ text: `Item ${i} ${'x'.repeat(150)}` }))
    const rec = input({
      summary: `One ${'a'.repeat(190)}. Two ${'b'.repeat(190)}. Three ${'c'.repeat(190)}. Four ${'d'.repeat(190)}. Enzo ${'e'.repeat(190)}.`,
      actionItems: long,
      actionViews: long.map(() => view('done', `https://example.org/${'p'.repeat(100)}`)),
    })
    const parts = buildRecapParts(rec, base, undefined, { ...LIMITS, minBullets: 3 }, people)
    expect(parts.text).not.toContain('Enzo')
    expect(parts.mentions.size).toBe(0)
  })
})

describe('repostRecap: ifChanged, hash and gone', () => {
  const env = { CALL_RECAP_POST_ENABLED: '1', DISCORD_BOT_TOKEN: 'tok' }
  const live = { ...env, CALL_RECAP_LIVE_STATUS_ENABLED: '1' }
  const published = {
    ...input({ actionItems: [{ text: 'Send the deck', owner: 'Ann', key: 'kkkkkkkk' }] }),
    status: 'PUBLISHED',
    crewId: 'community_call',
    eventName: null,
    recapPostedAt: new Date(),
    recapChannelId: '812143244149915679',
    recapMessageId: '999999999999999999',
    recapRenderedHash: null,
    redactionsUpdatedAt: null,
    summaryGeneratedAt: null,
    summaryEditedAt: null,
  }
  beforeEach(() => {
    db.callRecording.updateMany.mockResolvedValue({ count: 1 })
    db.callSpeaker.findMany.mockResolvedValue([])
    db.followUp.findMany.mockResolvedValue([{ actionKey: 'kkkkkkkk', status: 'IN_PROGRESS', doneUrl: null }])
  })

  it('with live status on the edit carries the status, and stores the hash and time', async () => {
    db.callRecording.findUnique.mockResolvedValue(published)
    const edit = vi.fn(async () => {})
    expect(await repostRecap('abc123', { edit: true }, { env: live, edit, base })).toBe('updated')
    const body = (edit.mock.calls[0] as unknown as [unknown, { content: string }])[1]
    expect(body.content).toContain('\u{1F504} Send the deck (owner: Ann)')
    expect(db.callRecording.updateMany).toHaveBeenCalledWith({ where: { id: 'abc123' }, data: { recapRenderedHash: expect.stringMatching(/^[0-9a-f]{64}$/), recapEditedAt: expect.any(Date) } })
  })

  it('with live status off the edit is the old text and the follow-ups are not even read', async () => {
    db.callRecording.findUnique.mockResolvedValue(published)
    const edit = vi.fn(async () => {})
    await repostRecap('abc123', { edit: true }, { env, edit, base })
    const body = (edit.mock.calls[0] as unknown as [unknown, { content: string }])[1]
    expect(body.content).toContain('- Send the deck (owner: Ann)')
    expect(db.followUp.findMany).not.toHaveBeenCalled()
  })

  it('ifChanged: an equal render is not sent again; a different one is', async () => {
    db.callRecording.findUnique.mockResolvedValue(published)
    await repostRecap('abc123', { edit: true }, { env: live, edit: vi.fn(async () => {}), base })
    const hash = (db.callRecording.updateMany.mock.calls.find((c) => (c[0] as { data: { recapRenderedHash?: string } }).data.recapRenderedHash)![0] as { data: { recapRenderedHash: string } }).data.recapRenderedHash
    const edit = vi.fn(async () => {})
    db.callRecording.findUnique.mockResolvedValue({ ...published, recapRenderedHash: hash })
    expect(await repostRecap('abc123', { edit: true, ifChanged: true }, { env: live, edit, base })).toBe('unchanged')
    expect(edit).not.toHaveBeenCalled()
    // The same row without ifChanged (the manual button) always edits.
    expect(await repostRecap('abc123', { edit: true }, { env: live, edit, base })).toBe('updated')
    // The status moved on: the render differs, so it edits.
    db.followUp.findMany.mockResolvedValue([{ actionKey: 'kkkkkkkk', status: 'DONE', doneUrl: null }])
    edit.mockClear()
    expect(await repostRecap('abc123', { edit: true, ifChanged: true }, { env: live, edit, base })).toBe('updated')
    expect(edit).toHaveBeenCalledTimes(1)
  })

  it('a deleted message or lost access is "gone", with a note, and is not retried by the caller', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    db.callRecording.findUnique.mockResolvedValue(published)
    for (const status of [404, 403]) {
      const edit = vi.fn(async () => { throw new DiscordPostError('Unknown Message', status) })
      expect(await repostRecap('abc123', { edit: true, ifChanged: true }, { env: live, edit, base })).toBe('gone')
    }
    expect(db.callRecording.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { recapError: 'edit failed: Unknown Message' } }))
    // Any other failure is just "failed".
    const edit = vi.fn(async () => { throw new DiscordPostError('Server error', 500) })
    expect(await repostRecap('abc123', { edit: true }, { env: live, edit, base })).toBe('failed')
  })
})
