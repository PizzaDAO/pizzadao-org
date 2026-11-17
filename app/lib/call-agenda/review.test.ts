// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/app/lib/db')

import { prisma } from '@/app/lib/db'
import { loadSettings, clearSettingsCache } from '@/app/lib/settings'
import { EMPTY_POST_FILTER } from '@/app/lib/calls/post-filters'
import { deriveActionViews } from '@/app/lib/calls/action-status'
import { buildReviewItems, loadAgendaReview, readStoredItems } from './review'

const NOW = new Date('2026-11-17T15:00:00Z')
const EVENT = new Date('2026-11-17T15:30:00Z')
const DAY = 24 * 3600 * 1000
const days = (n: number) => new Date(NOW.getTime() - n * DAY)

const rec = (o: Record<string, unknown> = {}) => ({
  id: 'rec1',
  startedAt: days(7),
  actionItems: [
    { text: 'Write guide', owner: 'Ana', key: 'k1', done: true, evidence: [{ url: 'https://github.com/o/r/pull/12' }] },
    { text: 'Book venue', owner: 'Ben', key: 'k2' },
    { text: 'Send newsletter', key: 'k3' },
  ],
  redactionsUpdatedAt: null,
  summaryGeneratedAt: days(7),
  summaryEditedAt: null,
  redactedSpeakerIds: [],
  ...o,
})

async function run(settingRows: Array<{ key: string; value: unknown }> = [], filter = EMPTY_POST_FILTER) {
  vi.mocked(prisma.appSetting.findMany).mockResolvedValue(settingRows as never)
  clearSettingsCache({ all: true })
  const settings = await loadSettings()
  return loadAgendaReview('ops', { now: NOW, eventStart: EVENT, filter, settings, chars: 110 })
}

describe('loadAgendaReview', () => {
  const saved = { ...process.env }
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.CALL_RECAP_LIVE_STATUS_ENABLED
    delete process.env.CALL_RECAP_MEMBER_LINKS_ENABLED
    vi.mocked(prisma.callRecording.findMany).mockResolvedValue([rec()] as never)
    vi.mocked(prisma.followUp.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.callSpeaker.findMany).mockResolvedValue([] as never)
  })
  afterEach(() => {
    process.env = { ...saved }
  })

  it('lists the items in stored order with the reviewers marks and links (live status off)', async () => {
    const r = await run()
    expect(r.review?.items).toEqual([
      { marker: '✅', text: 'Write guide (owner: Ana)', link: '[PR #12](<https://github.com/o/r/pull/12>)' },
      { marker: '-', text: 'Book venue (owner: Ben)' },
      { marker: '-', text: 'Send newsletter' },
    ])
    expect(r.review?.more).toBe(0)
    expect(r.review?.recordingId).toBe('rec1')
  })

  it('counts a call where every item is done (the old follow-up parser would skip it)', async () => {
    vi.mocked(prisma.callRecording.findMany).mockResolvedValue([rec({ actionItems: [{ text: 'A', done: true }, { text: 'B', done: true }] })] as never)
    const r = await run()
    expect(r.review?.items.map((i) => i.marker)).toEqual(['✅', '✅'])
  })

  it('only reads published calls before the event, discord only unless imported calls are allowed', async () => {
    await run()
    const arg = vi.mocked(prisma.callRecording.findMany).mock.calls[0][0] as { where: Record<string, unknown>; take: number }
    expect(arg.where).toMatchObject({ crewId: 'ops', status: 'PUBLISHED', startedAt: { lt: EVENT }, source: 'DISCORD' })
    expect(arg.take).toBe(3)
  })

  it('skips to the next recording when the latest has no items', async () => {
    vi.mocked(prisma.callRecording.findMany).mockResolvedValue([rec({ id: 'empty', actionItems: [] }), rec({ id: 'older' })] as never)
    expect((await run()).review?.recordingId).toBe('older')
  })

  it('leaves the block out for a call older than the max days (a saved setting)', async () => {
    vi.mocked(prisma.callRecording.findMany).mockResolvedValue([rec({ startedAt: days(36) })] as never)
    expect(await run()).toMatchObject({ review: null, skipped: 'none' })
    expect((await run([{ key: 'calls.agendaReviewMaxDays', value: 60 }])).review).not.toBeNull()
  })

  it('no call at all: no block', async () => {
    vi.mocked(prisma.callRecording.findMany).mockResolvedValue([])
    expect(await run()).toMatchObject({ review: null, skipped: 'none' })
  })

  it('redactions newer than the summary leave the block out', async () => {
    vi.mocked(prisma.callRecording.findMany).mockResolvedValue([rec({ redactionsUpdatedAt: days(1) })] as never)
    expect(await run()).toMatchObject({ review: null, skipped: 'stale-redactions' })
  })

  it('a redacted speaker is not named as an owner', async () => {
    vi.mocked(prisma.callRecording.findMany).mockResolvedValue([rec({ redactedSpeakerIds: ['9'] })] as never)
    vi.mocked(prisma.callSpeaker.findMany).mockResolvedValue([{ displayName: 'ben' }] as never)
    const r = await run()
    expect(r.review?.items[1].text).toBe('Book venue')
    expect(r.review?.items[0].text).toBe('Write guide (owner: Ana)')
  })

  it('drops items with a blocked term (text or owner) and counts them', async () => {
    const r = await run([], { ...EMPTY_POST_FILTER, blockedTerms: ['venue', 'ana'] })
    expect(r.review?.items.map((i) => i.text)).toEqual(['Send newsletter'])
    expect(r.filteredOut).toBe(2)
  })

  it('everything filtered: no block, counted', async () => {
    const r = await run([], { ...EMPTY_POST_FILTER, blockedTerms: ['venue', 'ana', 'newsletter'] })
    expect(r).toMatchObject({ review: null, skipped: 'filtered', filteredOut: 3 })
  })

  it('live status off: follow-ups are ignored (no cycle arrow) and never queried', async () => {
    vi.mocked(prisma.followUp.findMany).mockResolvedValue([{ actionKey: 'k2', status: 'IN_PROGRESS', doneUrl: null }] as never)
    const r = await run()
    expect(r.review?.items[1].marker).toBe('-')
    expect(prisma.followUp.findMany).not.toHaveBeenCalled()
  })

  it('live status on: in progress and needs help show the cycle arrow, a done follow-up shows done with the member link', async () => {
    process.env.CALL_RECAP_LIVE_STATUS_ENABLED = 'true'
    vi.mocked(prisma.followUp.findMany).mockResolvedValue([
      { actionKey: 'k2', status: 'NEEDS_HELP', doneUrl: null },
      { actionKey: 'k3', status: 'DONE', doneUrl: 'https://example.org/done' },
    ] as never)
    const r = await run()
    expect(r.review?.items.map((i) => i.marker)).toEqual(['✅', '🔄', '✅'])
    expect(r.review?.items[2].link).toBe('[example.org](<https://example.org/done>)')
  })

  it('live status on, member links off: the done state shows without the member link', async () => {
    process.env.CALL_RECAP_LIVE_STATUS_ENABLED = 'true'
    process.env.CALL_RECAP_MEMBER_LINKS_ENABLED = 'off'
    vi.mocked(prisma.followUp.findMany).mockResolvedValue([{ actionKey: 'k3', status: 'DONE', doneUrl: 'https://example.org/done' }] as never)
    const r = await run()
    expect(r.review?.items[2]).toEqual({ marker: '✅', text: 'Send newsletter' })
  })

  it('caps at the max items and counts the rest', async () => {
    const r = await run([{ key: 'calls.agendaReviewMaxItems', value: 2 }])
    expect(r.review?.items).toHaveLength(2)
    expect(r.review?.more).toBe(1)
  })

  it('open-first ordering is a saved setting; the default keeps the stored order', async () => {
    const r = await run([{ key: 'calls.agendaReviewOpenFirst', value: true }])
    expect(r.review?.items.map((i) => i.marker)).toEqual(['-', '-', '✅'])
    expect(r.review?.items.map((i) => i.text)).toEqual(['Book venue (owner: Ben)', 'Send newsletter', 'Write guide (owner: Ana)'])
  })

  it('a loader error gives no block and does not throw', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(prisma.callRecording.findMany).mockRejectedValue(new Error('db down'))
    expect(await run()).toEqual({ review: null, filteredOut: 0 })
  })
})

describe('buildReviewItems', () => {
  const opts = { filter: EMPTY_POST_FILTER, redactedNames: [], chars: 110, openFirst: false }
  it('escapes markdown, clips, and leaves long links out of the line', () => {
    const items = readStoredItems([{ text: '**bold** @everyone [x](http://e) ' + 'z'.repeat(300), owner: 'o'.repeat(80), key: 'a', done: true, evidence: [{ url: 'https://example.org/' + 'p'.repeat(250) }] }])
    const { lines } = buildReviewItems(items, deriveActionViews([{ key: 'a', done: true, evidence: [{ url: 'https://example.org/' + 'p'.repeat(250) }] }], [], { memberLinks: false }), opts)
    expect(lines[0].text).toContain('\\*\\*bold\\*\\*')
    expect(lines[0].text).toContain('\\[x\\]')
    expect(lines[0].link).toBeUndefined()
    expect(lines[0].text.length).toBeLessThan(110 + 60)
  })

  it('keeps item positions aligned with views when an entry is unusable', () => {
    const raw = [{ nope: 1 }, { text: 'Real', key: 'b', done: true }]
    const { lines } = buildReviewItems(readStoredItems(raw), deriveActionViews(raw, [], { memberLinks: false }), opts)
    expect(lines).toEqual([{ marker: '✅', text: 'Real' }])
  })
})
