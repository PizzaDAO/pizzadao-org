// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/app/lib/db')

import { prisma } from '@/app/lib/db'
import { clearSettingsCache } from '@/app/lib/settings'
import { EMPTY_POST_FILTER } from '@/app/lib/calls/post-filters'
import { enqueueMirror, processOutbox, targetCityKeys, toPlainPost, type MirrorKind } from './city-posts'
import { loadSettings } from '@/app/lib/settings'

const settingRows = vi.mocked(prisma.appSetting.findMany)
const createMany = vi.mocked(prisma.telegramGroupPost.createMany)
const findMany = vi.mocked(prisma.telegramGroupPost.findMany)
const updateMany = vi.mocked(prisma.telegramGroupPost.updateMany)
const update = vi.mocked(prisma.telegramGroupPost.update)
const groupBy = vi.mocked(prisma.telegramGroupPost.groupBy)

const PROD = { VERCEL_ENV: 'production', RSV_PIZZA_TELEGRAM_KEY: 'k' }
const NOW = new Date('2026-11-06T12:00:00Z')

function rows(o: Record<string, unknown>) {
  settingRows.mockResolvedValue(Object.entries(o).map(([key, value]) => ({ key, value })) as never)
  clearSettingsCache({ all: true })
}
const ON = {
  'telegram.cityPostsEnabled': true,
  'telegram.recapMirrorEnabled': true,
  'telegram.agendaMirrorEnabled': true,
  'telegram.announceMirrorEnabled': true,
  'telegram.crewCityGroups': [{ crewId: 'Ops Crew', cityKeys: 'Alpha town, beta' }],
  'telegram.announceCityKeys': ['gamma'],
}

beforeEach(() => {
  vi.resetAllMocks()
  rows({})
  createMany.mockResolvedValue({ count: 0 } as never)
  updateMany.mockResolvedValue({ count: 1 } as never)
  update.mockResolvedValue({} as never)
  groupBy.mockResolvedValue([] as never)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('toPlainPost', () => {
  it('drops Discord markup, mentions and bold markers, and keeps a link', () => {
    const out = toPlainPost('**Call recap: Ops**\n\n- one @everyone\n- <@123> two\n\nFull: https://example.org/calls/1')
    expect(out).toBe('Call recap: Ops\n\n- one\n- two\n\nFull: https://example.org/calls/1')
    expect(out).not.toMatch(/\*\*|@everyone|<@/)
  })

  it('adds the app link when the text has none, and caps the length', () => {
    expect(toPlainPost('hello', 'https://app.example')).toBe('hello\n\nhttps://app.example')
    expect(toPlainPost('x'.repeat(5000)).length).toBeLessThanOrEqual(3500)
  })
})

describe('targetCityKeys', () => {
  it('maps a crew to its cities (crew ids compare by slug) and announcements to the announce keys', async () => {
    rows(ON)
    const s = await loadSettings()
    expect(targetCityKeys('recap', 'ops_crew', s)).toEqual(['alpha town', 'beta'])
    expect(targetCityKeys('agenda', 'Ops Crew', s)).toEqual(['alpha town', 'beta'])
    expect(targetCityKeys('recap', 'other', s)).toEqual([])
    expect(targetCityKeys('recap', null, s)).toEqual([])
    expect(targetCityKeys('announce', null, s)).toEqual(['gamma'])
  })
})

describe('enqueueMirror', () => {
  const input = { kind: 'recap' as MirrorKind, sourceId: 'rec1', crewId: 'ops_crew', text: '**Recap**' }

  it('queues one row per city with skipDuplicates', async () => {
    rows(ON)
    createMany.mockResolvedValue({ count: 2 } as never)
    const r = await enqueueMirror(input, PROD, NOW)
    expect(r).toEqual({ queued: 2 })
    const arg = createMany.mock.calls[0][0]!
    expect(arg.skipDuplicates).toBe(true)
    expect(arg.data).toHaveLength(2)
    expect(arg.data).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'recap', sourceId: 'rec1', cityKey: 'beta', crewId: 'ops_crew' })]))
    // Default max age is 12 hours.
    expect((arg.data as Array<{ expiresAt: Date }>)[0].expiresAt.getTime()).toBe(NOW.getTime() + 12 * 3_600_000)
  })

  it('an agenda expires when the call starts', async () => {
    rows(ON)
    const startsAt = new Date('2026-11-06T13:00:00Z')
    await enqueueMirror({ ...input, kind: 'agenda', sourceId: 'e:1', text: 'Agenda', expiresAt: startsAt }, PROD, NOW)
    expect((createMany.mock.calls[0][0]!.data as Array<{ expiresAt: Date }>)[0].expiresAt).toEqual(startsAt)
  })

  it('queues nothing on a preview, without the key, or with the kill switch', async () => {
    rows(ON)
    expect((await enqueueMirror(input, { ...PROD, VERCEL_ENV: 'preview' }, NOW)).reason).toBe('send-off')
    expect((await enqueueMirror(input, { VERCEL_ENV: 'production' }, NOW)).reason).toBe('send-off')
    expect((await enqueueMirror(input, { ...PROD, TELEGRAM_SENDS_ENABLED: 'off' }, NOW)).reason).toBe('send-off')
    expect(createMany).not.toHaveBeenCalled()
  })

  it('queues nothing while a switch is off (default), or the env says off', async () => {
    expect((await enqueueMirror(input, PROD, NOW)).reason).toBe('switch-off')
    rows({ ...ON, 'telegram.recapMirrorEnabled': false })
    expect((await enqueueMirror(input, PROD, NOW)).reason).toBe('switch-off')
    rows(ON)
    expect((await enqueueMirror(input, { ...PROD, TELEGRAM_CITY_POSTS_ENABLED: 'off' }, NOW)).reason).toBe('switch-off')
    expect(createMany).not.toHaveBeenCalled()
  })

  it('queues nothing for a crew with no cities, and never throws', async () => {
    rows(ON)
    expect((await enqueueMirror({ ...input, crewId: 'nobody' }, PROD, NOW)).reason).toBe('no-cities')
    createMany.mockRejectedValue(new Error('db down'))
    await expect(enqueueMirror(input, PROD, NOW)).resolves.toEqual({ queued: 0, reason: 'error' })
  })

  it('announcements go to the announce cities', async () => {
    rows(ON)
    await enqueueMirror({ kind: 'announce', sourceId: 'announce:2026-11-06', text: 'Community call' }, PROD, NOW)
    expect((createMany.mock.calls[0][0]!.data as Array<{ cityKey: string }>).map((d) => d.cityKey)).toEqual(['gamma'])
  })
})

const row = (o: Record<string, unknown> = {}) => ({
  id: 'r1', kind: 'recap', sourceId: 's', crewId: 'ops_crew', cityKey: 'beta', text: 'hello world', status: 'PENDING', attempts: 0,
  sendAfter: null, claimedAt: null, expiresAt: new Date(NOW.getTime() + 3_600_000), messageId: null, code: null, createdAt: NOW, sentAt: null, ...o,
})
const deps = (post: ReturnType<typeof vi.fn>, extra: Record<string, unknown> = {}) => ({
  post: post as never, sleep: vi.fn(async () => {}), now: () => NOW, env: PROD, loadFilter: async () => EMPTY_POST_FILTER, ...extra,
})

describe('processOutbox', () => {
  beforeEach(() => rows(ON))

  it('does nothing (no queries, no calls) on a preview or while the master switch is off', async () => {
    const post = vi.fn()
    expect((await processOutbox(deps(post, { env: { ...PROD, VERCEL_ENV: 'preview' } }))).status).toBe('disabled')
    rows({})
    expect((await processOutbox(deps(post))).status).toBe('disabled')
    expect(post).not.toHaveBeenCalled()
    expect(findMany).not.toHaveBeenCalled()
  })

  it('sends with the row-id idempotency key and records SENT', async () => {
    findMany.mockResolvedValue([row()] as never)
    const post = vi.fn(async () => ({ ok: true, messageId: '77' }))
    const r = await processOutbox(deps(post))
    expect(post).toHaveBeenCalledWith({ cityKey: 'beta', text: 'hello world', idempotencyKey: 'tg:r1' }, { env: PROD })
    expect(r.sent).toBe(1)
    expect(update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: expect.objectContaining({ status: 'SENT', messageId: '77', code: null, claimedAt: null }) })
  })

  it('drops expired rows', async () => {
    findMany.mockResolvedValue([])
    updateMany.mockResolvedValue({ count: 3 } as never)
    const r = await processOutbox(deps(vi.fn()))
    expect(r.skipped).toBe(3)
    expect(updateMany.mock.calls[0][0]).toMatchObject({ where: { status: 'PENDING' }, data: { status: 'SKIPPED', code: 'expired' } })
  })

  it('re-checks the post filter: an excluded crew or a blocked term is SKIPPED', async () => {
    findMany.mockResolvedValue([row({ id: 'a' }), row({ id: 'b', crewId: 'fine', text: 'about widgets today' })] as never)
    const post = vi.fn()
    updateMany.mockResolvedValueOnce({ count: 0 } as never) // the expiry sweep
    const r = await processOutbox(deps(post, { loadFilter: async () => ({ excludedCrewIds: ['ops_crew'], excludedCrewLabelTerms: [], blockedTerms: ['widgets'] }) }))
    expect(post).not.toHaveBeenCalled()
    expect(r.skipped).toBe(2)
    expect(updateMany).toHaveBeenCalledWith({ where: { id: 'a', status: 'PENDING' }, data: expect.objectContaining({ status: 'SKIPPED', code: 'filtered' }) })
  })

  it('an unreadable filter sends nothing and leaves rows pending', async () => {
    findMany.mockResolvedValue([row()] as never)
    const post = vi.fn()
    const r = await processOutbox(deps(post, { loadFilter: async () => { throw new Error('x') } }))
    expect(post).not.toHaveBeenCalled()
    expect(r.stopped).toBe('filter-unavailable')
    expect(update).not.toHaveBeenCalled()
  })

  it('posts to one city one at a time with the gap, and respects the per-run cap', async () => {
    rows({ ...ON, 'telegram.maxSendsPerRun': 2, 'telegram.groupGapSeconds': 10 })
    findMany.mockResolvedValue([row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })] as never)
    let inFlight = 0
    let maxInFlight = 0
    const post = vi.fn(async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await Promise.resolve()
      inFlight -= 1
      return { ok: true as const, messageId: '1' }
    })
    const d = deps(post)
    const r = await processOutbox(d)
    expect(maxInFlight).toBe(1)
    expect(r.sent).toBe(2)
    expect(r.deferred).toBe(1)
    // The clock is frozen, so the second post to the same city waited the full gap.
    expect(d.sleep).toHaveBeenCalledWith(10_000)
  })

  it('a city that sent recently waits out the gap across runs; a long wait defers the row', async () => {
    findMany.mockResolvedValue([row()] as never)
    groupBy.mockResolvedValue([{ cityKey: 'beta', _max: { sentAt: new Date(NOW.getTime() - 4_000) } }] as never)
    const d = deps(vi.fn(async () => ({ ok: true as const })))
    await processOutbox(d)
    expect(d.sleep).toHaveBeenCalledWith(6_000)
    rows({ ...ON, 'telegram.groupGapSeconds': 60 })
    const d2 = deps(vi.fn())
    const r = await processOutbox(d2)
    expect(r.deferred).toBe(1)
    expect(d2.post).not.toHaveBeenCalled()
  })

  it('rate_limited: waits for retryAfter and counts the attempt; the fifth attempt FAILS', async () => {
    findMany.mockResolvedValue([row()] as never)
    const post = vi.fn(async () => ({ ok: false as const, code: 'rate_limited' as const, retryAfter: 30 }))
    const r = await processOutbox(deps(post))
    expect(r.deferred).toBe(1)
    expect(update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: expect.objectContaining({ sendAfter: new Date(NOW.getTime() + 30_000), code: 'rate_limited', claimedAt: null }) })
    findMany.mockResolvedValue([row({ attempts: 4 })] as never)
    const r5 = await processOutbox(deps(post))
    expect(r5.failed).toBe(1)
  })

  it('no_group / kicked are SKIPPED, uncertain is never retried, bad_request FAILS', async () => {
    for (const [code, status] of [['no_group', 'SKIPPED'], ['kicked', 'SKIPPED'], ['uncertain', 'UNCERTAIN'], ['bad_request', 'FAILED']] as const) {
      update.mockClear()
      findMany.mockResolvedValue([row()] as never)
      await processOutbox(deps(vi.fn(async () => ({ ok: false, code }))))
      expect(update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: expect.objectContaining({ status, code }) })
    }
  })

  it('a thrown error from the client is uncertain', async () => {
    findMany.mockResolvedValue([row()] as never)
    await processOutbox(deps(vi.fn(async () => { throw new Error('boom') })))
    expect(update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: expect.objectContaining({ status: 'UNCERTAIN' }) })
  })

  it.each(['not_configured', 'disabled', 'unavailable'])('%s keeps the row pending, does not count the attempt, and stops the run', async (code) => {
    findMany.mockResolvedValue([row({ id: 'a' }), row({ id: 'b', cityKey: 'other' })] as never)
    const post = vi.fn(async () => ({ ok: false as const, code: code as 'disabled' }))
    const r = await processOutbox(deps(post))
    expect(post).toHaveBeenCalledTimes(1)
    expect(r.stopped).toBe(code)
    expect(update).toHaveBeenCalledWith({ where: { id: 'a' }, data: { claimedAt: null, attempts: { decrement: 1 }, code } })
  })

  it('skips a row another run claimed first', async () => {
    findMany.mockResolvedValue([row()] as never)
    updateMany.mockResolvedValue({ count: 0 } as never)
    const post = vi.fn()
    await processOutbox(deps(post))
    expect(post).not.toHaveBeenCalled()
  })

  it('a lost claim makes the city busy for the rest of the run (no overlapping posts)', async () => {
    findMany.mockResolvedValue([row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c', cityKey: 'other' })] as never)
    updateMany.mockResolvedValueOnce({ count: 0 } as never) // expiry sweep
    updateMany.mockResolvedValueOnce({ count: 0 } as never) // claim of a: lost
    updateMany.mockResolvedValue({ count: 1 } as never)
    const post = vi.fn(async (_i: Record<string, unknown>) => ({ ok: true as const }))
    const r = await processOutbox(deps(post))
    expect(post).toHaveBeenCalledTimes(1)
    expect(post.mock.calls[0][0]).toMatchObject({ cityKey: 'other' })
    expect(r.deferred).toBe(2)
  })

  it('after a rate_limited row, later rows of that city wait so order holds', async () => {
    findMany.mockResolvedValue([row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c', cityKey: 'other' })] as never)
    const post = vi.fn(async (i: { cityKey: string }) => (i.cityKey === 'beta' ? { ok: false as const, code: 'rate_limited' as const, retryAfter: 5 } : { ok: true as const }))
    await processOutbox(deps(post as never))
    expect(post.mock.calls.map((c) => c[0].cityKey)).toEqual(['beta', 'other'])
  })

  it('a gap deferral also holds the city\'s later rows', async () => {
    rows({ ...ON, 'telegram.groupGapSeconds': 60 })
    findMany.mockResolvedValue([row({ id: 'a' }), row({ id: 'b' })] as never)
    groupBy.mockResolvedValue([{ cityKey: 'beta', _max: { sentAt: new Date(NOW.getTime() - 1_000) } }] as never)
    const post = vi.fn()
    const r = await processOutbox(deps(post))
    expect(post).not.toHaveBeenCalled()
    expect(r.deferred).toBe(2)
  })

  it('uses the stored crew label for the exclusion check', async () => {
    findMany.mockResolvedValue([row({ crewId: 'ops_crew', crewLabel: 'Secret Squad' })] as never)
    const post = vi.fn()
    updateMany.mockResolvedValueOnce({ count: 0 } as never)
    const r = await processOutbox(deps(post, { loadFilter: async () => ({ excludedCrewIds: [], excludedCrewLabelTerms: ['squad'], blockedTerms: [] }) }))
    expect(post).not.toHaveBeenCalled()
    expect(r.skipped).toBe(1)
  })

  it('re-checks the per-kind switch at send time: a disabled kind stays PENDING', async () => {
    rows({ ...ON, 'telegram.agendaMirrorEnabled': false })
    findMany.mockResolvedValue([row({ id: 'a', kind: 'agenda' }), row({ id: 'b', kind: 'recap', cityKey: 'other' })] as never)
    const post = vi.fn(async (_i: Record<string, unknown>) => ({ ok: true as const }))
    const r = await processOutbox(deps(post))
    expect(post).toHaveBeenCalledTimes(1)
    expect(post.mock.calls[0][0]).toMatchObject({ idempotencyKey: 'tg:b' })
    expect(r.deferred).toBe(1)
  })

  it('only fetches rows of kinds whose switch is on', async () => {
    rows({ ...ON, 'telegram.agendaMirrorEnabled': false })
    findMany.mockResolvedValue([])
    await processOutbox(deps(vi.fn()))
    expect(findMany.mock.calls[0][0]!.where).toMatchObject({ kind: { in: ['recap', 'announce'] } })
    rows({ ...ON, 'telegram.recapMirrorEnabled': false, 'telegram.agendaMirrorEnabled': false, 'telegram.announceMirrorEnabled': false })
    findMany.mockClear()
    await processOutbox(deps(vi.fn()))
    expect(findMany).not.toHaveBeenCalled()
  })
})
