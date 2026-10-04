// @vitest-environment node
// The daily mission review SLA digest (Phase 3), with injected deps.
import { describe, it, expect, vi } from 'vitest'

vi.mock('../db', () => ({ prisma: {} }))
vi.mock('../discord', () => ({ getUserRoles: vi.fn(async () => []) }))

import { dayKey, renderSlaDigest, rolesToPing, runSlaDigest, selectOverdue, type SlaCandidate, type SlaDeps } from './sla'

const H = 3_600_000
const NOW = new Date('2026-10-03T15:00:00Z')
const LEONARDO = '815269418305191946'
const DPR = '812131585327235113'
const CAPO = '839206162837798945'
const MAFIA = '823266914834841610'

const row = (id: number, over: Partial<SlaCandidate> = {}): SlaCandidate => ({
  id,
  discordId: `10000000000000000${id}`,
  level: 3,
  index: 0,
  title: `Mission ${id}`,
  holdReason: null,
  submittedAt: new Date(NOW.getTime() - 60 * H),
  reviewQueuedAt: null,
  reviewMsgId: null,
  reviewChannelId: null,
  ...over,
})

describe('selectOverdue', () => {
  it('lists PENDING items waiting more than 48 h, oldest first', () => {
    const rows = [
      row(1, { submittedAt: new Date(NOW.getTime() - 49 * H) }),
      row(2, { submittedAt: new Date(NOW.getTime() - 47 * H) }), // inside the SLA
      row(3, { submittedAt: new Date(NOW.getTime() - 96 * H) }),
      row(4, { submittedAt: new Date(NOW.getTime() - 48 * H) }), // exactly 48 h: not over yet
    ]
    expect(selectOverdue(rows, NOW).map((r) => r.id)).toEqual([3, 1])
  })

  it('the clock is reviewQueuedAt when set (a resubmission / hold / reopen restarts it), else submittedAt', () => {
    const rows = [
      row(1, { submittedAt: new Date(NOW.getTime() - 200 * H), reviewQueuedAt: new Date(NOW.getTime() - 2 * H) }),
      row(2, { submittedAt: new Date(NOW.getTime() - 200 * H), reviewQueuedAt: new Date(NOW.getTime() - 50 * H) }),
    ]
    const out = selectOverdue(rows, NOW)
    expect(out.map((r) => r.id)).toEqual([2])
    expect(out[0].waitingMs).toBe(50 * H)
  })
})

describe('renderSlaDigest', () => {
  it('pings the reviewer roles (never @everyone) and links each card', () => {
    const items = selectOverdue([row(1, { reviewMsgId: '300000000000000001', reviewChannelId: '200000000000000001' }), row(2, { holdReason: 'HIGH_LEVEL', level: 6 })], NOW)
    const body = renderSlaDigest(items, { guildId: '812097286003359764', appUrl: 'https://app.pizzadao.org' })
    const roles = [LEONARDO, DPR, CAPO, MAFIA]
    expect(new Set(body.allowed_mentions?.roles)).toEqual(new Set(roles))
    expect(body.allowed_mentions?.parse).toEqual([])
    expect(body.content).not.toMatch(/@everyone|@here/)
    for (const r of roles) expect(body.content).toContain(`<@&${r}>`)
    const d = (body.embeds![0] as { description: string }).description
    expect(d).toMatch(/^⏳ 2 mission reviews are past the 48h target/)
    expect(d).toContain('https://discord.com/channels/812097286003359764/200000000000000001/300000000000000001')
    expect(d).toContain('needs approval')
    expect(d).toContain('waiting 2d 12h')
  })

  it('an overdue L8 pings Dread Pizza Roberts; only L8 items ping only DPR', () => {
    expect(rolesToPing([{ level: 8 }])).toEqual([DPR])
    expect(new Set(rolesToPing([{ level: 8 }, { level: 2 }]))).toEqual(new Set([DPR, LEONARDO, CAPO, MAFIA]))
  })

  it('caps the list and counts the rest', () => {
    const items = selectOverdue(Array.from({ length: 20 }, (_, i) => row(i + 1)), NOW)
    const d = (renderSlaDigest(items, { guildId: null, appUrl: 'https://app.pizzadao.org' }).embeds![0] as { description: string }).description
    expect(d).toContain('15 - ')
    expect(d).not.toContain('16 - ')
    expect(d).toContain('…and 5 more')
  })
})

/** In-memory MissionSlaDigest: the day key is unique, like the table's primary key. */
function makeDeps(rows: SlaCandidate[], over: Partial<SlaDeps> = {}) {
  const days = new Map<string, { messageId: string | null }>()
  const d = {
    days,
    enabled: () => true,
    pending: vi.fn(async () => rows),
    claimDay: vi.fn(async (day: string) => {
      await new Promise((r) => setTimeout(r, Math.random() * 3))
      if (days.has(day)) return false
      days.set(day, { messageId: null })
      return true
    }),
    releaseDay: vi.fn(async (day: string) => {
      if (days.get(day)?.messageId === null) days.delete(day)
    }),
    recordDay: vi.fn(async (day: string, r: { messageId: string | null }) => {
      days.set(day, { messageId: r.messageId })
    }),
    markNotified: vi.fn(async () => undefined),
    resolveChannel: vi.fn(async () => '200000000000000001'),
    post: vi.fn(async () => ({ id: '400000000000000001' })),
    guildId: () => '812097286003359764',
    appUrl: () => 'https://app.pizzadao.org',
    ...over,
  }
  return d
}

describe('runSlaDigest', () => {
  it('disabled (MISSION_REVIEW_CARDS_ENABLED off): reads and posts nothing', async () => {
    const d = makeDeps([row(1)], { enabled: () => false })
    expect(await runSlaDigest(d, NOW)).toEqual({ status: 'disabled' })
    expect(d.pending).not.toHaveBeenCalled()
  })

  it('nothing overdue: no post, and the day stays unclaimed', async () => {
    const d = makeDeps([row(1, { submittedAt: new Date(NOW.getTime() - H) })])
    expect(await runSlaDigest(d, NOW)).toEqual({ status: 'none', pending: 1 })
    expect(d.claimDay).not.toHaveBeenCalled()
    expect(d.post).not.toHaveBeenCalled()
  })

  it('posts one card in #work, records the day and marks the listed items', async () => {
    const d = makeDeps([row(1), row(2, { submittedAt: new Date(NOW.getTime() - H) })])
    const r = await runSlaDigest(d, NOW)
    expect(r).toMatchObject({ status: 'posted', day: '2026-10-03', overdue: 1, messageId: '400000000000000001' })
    expect(d.post).toHaveBeenCalledTimes(1)
    expect(vi.mocked(d.post).mock.calls[0][0]).toBe('200000000000000001')
    expect(d.recordDay).toHaveBeenCalledWith('2026-10-03', { channelId: '200000000000000001', messageId: '400000000000000001', overdue: 1 })
    expect(d.markNotified).toHaveBeenCalledWith([1], NOW)
  })

  it('once per day: a second (or concurrent) run the same day posts nothing; the next day posts again', async () => {
    const d = makeDeps([row(1)])
    const runs = await Promise.all(Array.from({ length: 5 }, () => runSlaDigest(d, NOW)))
    expect(runs.filter((r) => r.status === 'posted')).toHaveLength(1)
    expect(runs.filter((r) => r.status === 'already_sent')).toHaveLength(4)
    expect(await runSlaDigest(d, new Date(NOW.getTime() + 2 * H))).toMatchObject({ status: 'already_sent' })
    expect(d.post).toHaveBeenCalledTimes(1)
    const tomorrow = new Date(NOW.getTime() + 24 * H)
    expect(await runSlaDigest(d, tomorrow)).toMatchObject({ status: 'posted', day: dayKey(tomorrow) })
    expect(d.post).toHaveBeenCalledTimes(2)
  })

  it('a failed post releases the day so a re-run can post', async () => {
    const d = makeDeps([row(1)], { post: vi.fn(async () => Promise.reject(new Error('Discord 500'))) })
    await expect(runSlaDigest(d, NOW)).rejects.toThrow('Discord 500')
    expect(d.days.has('2026-10-03')).toBe(false)
    d.post = vi.fn(async () => ({ id: '400000000000000002' }))
    expect(await runSlaDigest(d, NOW)).toMatchObject({ status: 'posted' })
  })

  it('no #work channel: releases the day', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const d = makeDeps([row(1)], { resolveChannel: vi.fn(async () => null) })
    expect(await runSlaDigest(d, NOW)).toEqual({ status: 'no_channel', overdue: 1 })
    expect(d.days.size).toBe(0)
    spy.mockRestore()
  })
})
