// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/app/lib/db')
vi.mock('@/app/lib/crew-mappings', () => ({
  getCrewMappings: vi.fn(),
  fetchOpenCrewTasksForCrew: vi.fn(),
}))
vi.mock('@/app/lib/discord-rest', async (orig) => ({
  ...(await orig<typeof import('@/app/lib/discord-rest')>()),
  postDiscordMessage: vi.fn(),
}))
vi.mock('@/app/lib/telegram/city-posts', () => ({ enqueueMirror: vi.fn(async () => ({ queued: 0 })) }))
vi.mock('@/app/lib/discord-channels', async (orig) => ({
  ...(await orig<typeof import('@/app/lib/discord-channels')>()),
  getGuildChannels: vi.fn(),
}))

import { prisma } from '@/app/lib/db'
import { getCrewMappings, fetchOpenCrewTasksForCrew } from '@/app/lib/crew-mappings'
import { postDiscordMessage, DiscordPostError } from '@/app/lib/discord-rest'
import { getGuildChannels } from '@/app/lib/discord-channels'
import { buildAgendaBullets, daysOverdue, parseActionItems, parseAgendaLinks, formatAgendaMessage, agendaTimeZone } from './rank'
import { clearPostFilterCache } from '@/app/lib/calls/post-filters'
import { clearSettingsCache } from '@/app/lib/settings'
import { enqueueMirror } from '@/app/lib/telegram/city-posts'
import { runCallAgenda, resolveCrewChannel, fetchUpcomingEvents } from './run'

const NOW = new Date('2026-10-29T15:00:00Z')
const task = (label: string, o: Record<string, unknown> = {}) => ({ label, stage: 'todo', isActive: false, ...o }) as never

describe('buildAgendaBullets', () => {
  it('ranks overdue first (most overdue first), then Top, then High', () => {
    const b = buildAgendaBullets({
      now: NOW,
      tasks: [
        task('High one', { priority: 'High' }),
        task('Top one', { priority: 'Top' }),
        task('Late 2d', { due: '2026-10-27' }),
        task('Late 9d', { due: '2026-10-20', priority: 'Low' }),
        task('Mid not urgent', { priority: 'Mid' }),
      ],
    })
    expect(b.map((x) => x.text)).toEqual(['Overdue 9d: Late 9d', 'Overdue 2d: Late 2d', 'Top priority: Top one', 'High priority: High one'])
  })

  it('adds previous action items and caps at 7 bullets', () => {
    const tasks = Array.from({ length: 12 }, (_, i) => task(`T${i}`, { priority: 'Top' }))
    const b = buildAgendaBullets({ now: NOW, tasks, actionItems: [{ text: 'Send deck', owner: 'Ana' }, { text: 'Book venue' }, { text: 'third ignored' }] })
    expect(b.length).toBeLessThanOrEqual(7)
    expect(b.filter((x) => x.kind === 'followup').map((x) => x.text)).toEqual(['From last call: Send deck (Ana)', 'From last call: Book venue'])
  })

  it('pads toward 3 with in-progress tasks and is empty with nothing urgent', () => {
    const b = buildAgendaBullets({ now: NOW, tasks: [task('A', { isActive: true, priority: 'Mid' }), task('B', { isActive: true }), task('C', { isActive: true }), task('D', { isActive: true })] })
    expect(b).toHaveLength(3)
    expect(b.every((x) => x.kind === 'active')).toBe(true)
    expect(buildAgendaBullets({ now: NOW, tasks: [task('x', { priority: 'Low' })] })).toEqual([])
  })

  it('is deterministic and clips long labels', () => {
    const t = [task('x'.repeat(300), { priority: 'Top' })]
    const a = buildAgendaBullets({ now: NOW, tasks: t })
    expect(a).toEqual(buildAgendaBullets({ now: NOW, tasks: t }))
    expect(a[0].text.length).toBeLessThan(140)
  })
})

describe('helpers', () => {
  it('daysOverdue', () => {
    expect(daysOverdue('2026-10-29', NOW)).toBe(0)
    expect(daysOverdue('2026-10-28', NOW)).toBe(1)
    expect(daysOverdue(undefined, NOW)).toBe(0)
  })
  it('parseActionItems tolerates junk', () => {
    expect(parseActionItems(null)).toEqual([])
    expect(parseActionItems(['a', { text: 'b', owner: 'C' }, { nope: 1 }, 5])).toEqual([{ text: 'a' }, { text: 'b', owner: 'C' }])
  })
  it('finished (done) action items do not come back as follow-ups', () => {
    expect(parseActionItems([{ text: 'a', done: true }, { text: 'b', done: false }])).toEqual([{ text: 'b', owner: null }])
    const b = buildAgendaBullets({ now: NOW, tasks: [], actionItems: [{ text: 'Closed', done: true }, { text: 'Open' }] })
    expect(b.map((x) => x.text).join('\n')).toContain('From last call: Open')
    expect(b.map((x) => x.text).join('\n')).not.toContain('Closed')
  })
  it('formatAgendaMessage ends with the crew link', () => {
    const m = formatAgendaMessage({ crewLabel: 'Ops', startsAt: NOW, bullets: [{ kind: 'priority', text: 'Top priority: X' }], crewUrl: 'https://x/crew/ops' })
    expect(m.split('\n').at(-1)).toBe('Crew page: https://x/crew/ops')
    expect(m).toContain('- Top priority: X')
  })
  it('formatAgendaMessage uses a configured link label', () => {
    const m = formatAgendaMessage({ crewLabel: 'Ops', startsAt: NOW, bullets: [], crewUrl: 'https://x/guide', linkLabel: 'Call guide' })
    expect(m.split('\n').at(-1)).toBe('Call guide: https://x/guide')
  })
  it('parseAgendaLinks reads crew lines and skips bad ones', () => {
    const links = parseAgendaLinks('Ops = Call guide | https://x/guide\n\nbad line\ntech = Docs | http://not-https')
    expect([...links.entries()]).toEqual([['ops', { label: 'Call guide', url: 'https://x/guide' }]])
  })
  it('resolveCrewChannel handles ids, links and mentions that belong to the guild (L1)', async () => {
    process.env.DISCORD_GUILD_ID = '1'
    vi.mocked(getGuildChannels).mockResolvedValue([
      { id: '123456789012345678', name: 'ops', type: 0 },
      { id: '222222222222222222', name: 'pizza-ops', type: 0 },
      { id: '333333333333333333', name: 'lounge', type: 2 },
    ])
    expect(await resolveCrewChannel('123456789012345678')).toBe('123456789012345678')
    expect(await resolveCrewChannel('999999999999999999')).toBeNull() // not in this guild
    expect(await resolveCrewChannel('https://discord.com/channels/1/222222222222222222')).toBe('222222222222222222')
    expect(await resolveCrewChannel('https://discord.com/channels/2/222222222222222222')).toBeNull() // other guild
    expect(await resolveCrewChannel('<#333333333333333333>')).toBeNull() // voice channel
    expect(await resolveCrewChannel('#ops')).toBe('123456789012345678')
    expect(await resolveCrewChannel('ops-')).toBe('123456789012345678')
    expect(await resolveCrewChannel('crew')).toBeNull() // no suffix fallback
    expect(await resolveCrewChannel('')).toBeNull()
    vi.mocked(getGuildChannels).mockResolvedValue(null)
    expect(await resolveCrewChannel('123456789012345678')).toBeNull()
  })

  it('computes overdue in the configured zone (M3)', () => {
    // 02:00 UTC on the 29th is still the 28th in New York.
    const late = new Date('2026-10-29T02:00:00Z')
    expect(daysOverdue('2026-10-28', late, 'America/New_York')).toBe(0)
    expect(daysOverdue('2026-10-28', late, 'UTC')).toBe(1)
    expect(agendaTimeZone({ CALL_AGENDA_TZ: 'Not/AZone' } as never)).toBe('America/New_York')
  })

  it('escapes Discord markdown in sheet text (L2)', () => {
    const [b] = buildAgendaBullets({ now: NOW, tasks: [task('**bold** [x](http://e) _i_ <@1>', { priority: 'Top' })] })
    expect(b.text).toBe('Top priority: \\*\\*bold\\*\\* \\[x\\](http://e) \\_i\\_ \\<@1\\>')
  })
})

const events = [
  { id: '111111111111111111', name: 'Ops Call', channel_id: '823956905739026442', status: 1, scheduled_start_time: '2026-10-29T15:20:00Z' },
  { id: '222222222222222222', name: 'Other voice', channel_id: '999', status: 1, scheduled_start_time: '2026-10-29T15:20:00Z' },
  { id: '333333333333333333', name: 'Too far', channel_id: '823956905739026442', status: 1, scheduled_start_time: '2026-10-29T18:00:00Z' },
  { id: '444444444444444444', name: 'Past', channel_id: '823956905739026442', status: 1, scheduled_start_time: '2026-10-29T14:00:00Z' },
]
const fetchEvents = (async () => ({ ok: true, status: 200, json: async () => events })) as unknown as typeof fetch

describe('runCallAgenda', () => {
  const saved = { ...process.env }
  beforeEach(() => {
    vi.clearAllMocks()
    clearPostFilterCache()
    vi.mocked(prisma.appSetting.findMany).mockResolvedValue([])
    process.env.DISCORD_BOT_TOKEN = 'tok'
    process.env.DISCORD_GUILD_ID = '1'
    process.env.CALL_AGENDA_POST_ENABLED = 'true'
    vi.mocked(getCrewMappings).mockResolvedValue({
      cached: false,
      crews: [{ id: 'ops', label: 'Ops', turtles: [], event: '111111111111111111', channel: '555555555555555555', sheet: 'https://docs.google.com/spreadsheets/d/abc/edit' }],
    })
    vi.mocked(fetchOpenCrewTasksForCrew).mockResolvedValue({ tasks: [task('Ship thing', { priority: 'Top' })], error: false })
    vi.mocked(getGuildChannels).mockResolvedValue([{ id: '555555555555555555', name: 'ops', type: 0 }])
    vi.mocked(prisma.callRecording.findMany).mockResolvedValue([])
    vi.mocked(prisma.callAgendaPost.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.callAgendaPost.create).mockResolvedValue({} as never)
    vi.mocked(prisma.callAgendaPost.update).mockResolvedValue({} as never)
    vi.mocked(prisma.callAgendaPost.delete).mockResolvedValue({} as never)
    vi.mocked(postDiscordMessage).mockResolvedValue({ id: 'm1' })
  })
  afterEach(() => {
    process.env = { ...saved }
  })

  it('only considers call-channel events inside the lead window', async () => {
    const got = await fetchUpcomingEvents({ now: NOW, horizonMs: 30 * 60 * 1000, fetchImpl: fetchEvents })
    expect(got.map((e) => e.id)).toEqual(['111111111111111111'])
  })

  it('does nothing when disabled', async () => {
    process.env.CALL_AGENDA_POST_ENABLED = ''
    expect(await runCallAgenda({ now: NOW, fetchImpl: fetchEvents })).toEqual({ status: 'disabled', outcomes: [] })
    expect(postDiscordMessage).not.toHaveBeenCalled()
  })

  it('posts once to the crew channel and records it', async () => {
    const r = await runCallAgenda({ now: NOW, fetchImpl: fetchEvents })
    expect(r.outcomes).toEqual([{ eventId: '111111111111111111', crewId: 'ops', status: 'posted', messageId: 'm1' }])
    expect(postDiscordMessage).toHaveBeenCalledTimes(1)
    const [target, body] = vi.mocked(postDiscordMessage).mock.calls[0]
    expect(target).toMatchObject({ kind: 'bot', channelId: '555555555555555555' })
    expect(body.content).toContain('Top priority: Ship thing')
    expect(body.content).toContain('/crew/ops')
  })

  it('mirrors the agenda to Telegram only after the claim, expiring when the call starts', async () => {
    await runCallAgenda({ now: NOW, fetchImpl: fetchEvents })
    expect(enqueueMirror).toHaveBeenCalledTimes(1)
    const arg = vi.mocked(enqueueMirror).mock.calls[0][0]
    expect(arg).toMatchObject({ kind: 'agenda', crewId: 'ops' })
    expect(arg.sourceId).toMatch(/^111111111111111111:/)
    expect(arg.text).toContain('Top priority: Ship thing')
    expect(arg.expiresAt).toBeInstanceOf(Date)
  })

  it('mirrors on an uncertain Discord outcome but never when Discord refused', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(postDiscordMessage).mockRejectedValue(new DiscordPostError('forbidden', 403))
    await runCallAgenda({ now: NOW, fetchImpl: fetchEvents })
    expect(enqueueMirror).not.toHaveBeenCalled()
    vi.mocked(postDiscordMessage).mockRejectedValue(new DiscordPostError('bad gateway', 502))
    await runCallAgenda({ now: NOW, fetchImpl: fetchEvents })
    expect(enqueueMirror).toHaveBeenCalledTimes(1)
  })

  it('does not mirror when nothing was claimed', async () => {
    vi.mocked(prisma.callAgendaPost.create).mockRejectedValue({ code: 'P2002' })
    await runCallAgenda({ now: NOW, fetchImpl: fetchEvents })
    vi.mocked(prisma.callAgendaPost.findFirst).mockResolvedValue({ id: 'x' } as never)
    await runCallAgenda({ now: NOW, fetchImpl: fetchEvents })
    expect(enqueueMirror).not.toHaveBeenCalled()
  })

  it('skips an occurrence that is already recorded, or whose claim loses the race', async () => {
    vi.mocked(prisma.callAgendaPost.findFirst).mockResolvedValue({ id: 'x' } as never)
    expect((await runCallAgenda({ now: NOW, fetchImpl: fetchEvents })).outcomes[0].status).toBe('already-posted')
    vi.mocked(prisma.callAgendaPost.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.callAgendaPost.create).mockRejectedValue({ code: 'P2002' })
    expect((await runCallAgenda({ now: NOW, fetchImpl: fetchEvents })).outcomes[0].status).toBe('already-posted')
    expect(postDiscordMessage).not.toHaveBeenCalled()
  })

  it('M1: a post for the same event within +-6h (rescheduled) counts as posted', async () => {
    vi.mocked(prisma.callAgendaPost.findFirst).mockResolvedValue({ id: 'old' } as never)
    const r = await runCallAgenda({ now: NOW, fetchImpl: fetchEvents })
    expect(r.outcomes[0].status).toBe('already-posted')
    const where = vi.mocked(prisma.callAgendaPost.findFirst).mock.calls[0][0]!.where as { eventId: string; startsAt: { gte: Date; lte: Date } }
    expect(where.eventId).toBe('111111111111111111')
    expect(where.startsAt.lte.getTime() - where.startsAt.gte.getTime()).toBe(12 * 60 * 60 * 1000)
    expect(prisma.callAgendaPost.create).not.toHaveBeenCalled()
  })

  it('M2: releases the claim only on definite failures; keeps it on 5xx / network errors', async () => {
    vi.mocked(postDiscordMessage).mockRejectedValue(new DiscordPostError('forbidden', 403))
    expect((await runCallAgenda({ now: NOW, fetchImpl: fetchEvents })).outcomes[0].status).toBe('failed')
    expect(prisma.callAgendaPost.delete).toHaveBeenCalledTimes(1)
    vi.mocked(postDiscordMessage).mockRejectedValue(new DiscordPostError('bad gateway', 502))
    expect((await runCallAgenda({ now: NOW, fetchImpl: fetchEvents })).outcomes[0].status).toBe('post-uncertain')
    vi.mocked(postDiscordMessage).mockRejectedValue(new Error('timeout'))
    expect((await runCallAgenda({ now: NOW, fetchImpl: fetchEvents })).outcomes[0].status).toBe('post-uncertain')
    expect(prisma.callAgendaPost.delete).toHaveBeenCalledTimes(1)
  })

  it('L2: posts with SUPPRESS_EMBEDS and no mentions', async () => {
    await runCallAgenda({ now: NOW, fetchImpl: fetchEvents })
    const body = vi.mocked(postDiscordMessage).mock.calls[0][1]
    expect(body.flags).toBe(4)
    expect(body.allowed_mentions).toEqual({ parse: [] })
  })

  it('L3: a sheet error is reported and nothing is claimed', async () => {
    vi.mocked(fetchOpenCrewTasksForCrew).mockResolvedValue({ tasks: [], error: true })
    const r = await runCallAgenda({ now: NOW, fetchImpl: fetchEvents })
    expect(r.outcomes[0].status).toBe('sheet-error')
    expect(prisma.callAgendaPost.create).not.toHaveBeenCalled()
  })

  it('L5: an unexpected error for one crew is isolated', async () => {
    vi.mocked(prisma.callAgendaPost.create).mockRejectedValue(new Error('db down'))
    const r = await runCallAgenda({ now: NOW, fetchImpl: fetchEvents })
    expect(r.status).toBe('ran')
    expect(r.outcomes[0].status).toBe('error')
  })

  it('posts nothing when no tasks are urgent', async () => {
    vi.mocked(fetchOpenCrewTasksForCrew).mockResolvedValue({ tasks: [], error: false })
    const r = await runCallAgenda({ now: NOW, fetchImpl: fetchEvents })
    expect(r.outcomes[0].status).toBe('no-items')
    expect(prisma.callAgendaPost.create).not.toHaveBeenCalled()
  })

  const setFilter = (f: Partial<{ excludedCrewIds: string[]; excludedCrewLabelTerms: string[]; blockedTerms: string[] }>) =>
    vi.mocked(prisma.appSetting.findMany).mockResolvedValue([{ key: 'calls.postFilter', value: { excludedCrewIds: [], excludedCrewLabelTerms: [], blockedTerms: [], ...f } }] as never)

  it('skips an excluded crew entirely: outcome excluded, no sheet read, no claim, no post', async () => {
    setFilter({ excludedCrewIds: ['crew_x'] })
    vi.mocked(getCrewMappings).mockResolvedValue({
      cached: false,
      crews: [{ id: 'crew_x', label: 'Crew X', turtles: [], event: '111111111111111111', channel: '555555555555555555', sheet: 'https://docs.google.com/spreadsheets/d/abc/edit' }],
    })
    const r = await runCallAgenda({ now: NOW, fetchImpl: fetchEvents })
    expect(r.outcomes).toEqual([{ eventId: '111111111111111111', crewId: 'crew_x', status: 'excluded' }])
    expect(fetchOpenCrewTasksForCrew).not.toHaveBeenCalled()
    expect(prisma.callAgendaPost.create).not.toHaveBeenCalled()
    expect(postDiscordMessage).not.toHaveBeenCalled()
  })

  it('excludes a crew by label word', async () => {
    setFilter({ excludedCrewLabelTerms: ['ZETA'] })
    vi.mocked(getCrewMappings).mockResolvedValue({
      cached: false,
      crews: [{ id: 'ops', label: 'Zeta Ops', turtles: [], event: '111111111111111111', channel: '555555555555555555', sheet: 'https://docs.google.com/spreadsheets/d/abc/edit' }],
    })
    expect((await runCallAgenda({ now: NOW, fetchImpl: fetchEvents })).outcomes[0].status).toBe('excluded')
    expect(postDiscordMessage).not.toHaveBeenCalled()
  })

  it('posts nothing when the filter cannot be read', async () => {
    vi.mocked(prisma.appSetting.findMany).mockRejectedValue(new Error('db down'))
    await expect(runCallAgenda({ now: NOW, fetchImpl: fetchEvents })).rejects.toThrow('Post filter could not be read')
    expect(postDiscordMessage).not.toHaveBeenCalled()
    expect(prisma.callAgendaPost.create).not.toHaveBeenCalled()
  })

  it('drops tasks and last-call items with a blocked term and counts them', async () => {
    setFilter({ blockedTerms: ['ZETA'] })
    vi.mocked(fetchOpenCrewTasksForCrew).mockResolvedValue({
      tasks: [task('Ship thing', { priority: 'Top' }), task('Sync with zeta team', { priority: 'Top' })],
      error: false,
    })
    vi.mocked(prisma.callRecording.findMany).mockResolvedValue([{ actionItems: [{ text: 'Call the Zeta leads' }, { text: 'Book venue' }] }] as never)
    const { planAgendas } = await import('./run')
    const [plan] = await planAgendas({ now: NOW, horizonMs: 30 * 60 * 1000, fetchImpl: fetchEvents })
    expect(plan.filteredOut).toBe(2)
    expect(plan.message.toLowerCase()).not.toContain('zeta')
    expect(plan.message).toContain('Ship thing')
    expect(plan.message).toContain('Book venue')
  })

  it('swaps the crew page for the link set in calls.agendaLinks', async () => {
    vi.mocked(prisma.appSetting.findMany).mockResolvedValue([{ key: 'calls.agendaLinks', value: 'ops = Call guide | https://x/guide' }] as never)
    const { planAgendas } = await import('./run')
    const [plan] = await planAgendas({ now: NOW, horizonMs: 30 * 60 * 1000, fetchImpl: fetchEvents })
    expect(plan.message.split('\n').at(-1)).toBe('Call guide: https://x/guide')
  })

  describe('review block (calls.agendaReviewEnabled)', () => {
    const REC = (items: unknown[], o: Record<string, unknown> = {}) =>
      ({ id: 'rec1', startedAt: new Date('2026-10-22T15:00:00Z'), actionItems: items, redactionsUpdatedAt: null, summaryGeneratedAt: new Date('2026-10-22T16:00:00Z'), summaryEditedAt: null, redactedSpeakerIds: [], ...o }) as never
    const plan = async () => {
      const { planAgendas } = await import('./run')
      return planAgendas({ now: NOW, horizonMs: 30 * 60 * 1000, fetchImpl: fetchEvents })
    }
    const on = () => {
      process.env.CALL_AGENDA_REVIEW_ENABLED = 'true'
      clearSettingsCache({ all: true })
    }
    beforeEach(() => {
      delete process.env.CALL_AGENDA_REVIEW_ENABLED
      clearSettingsCache({ all: true })
    })

    it('off: the message is exactly the old one and the extra calls are not made', async () => {
      vi.mocked(prisma.callRecording.findMany).mockResolvedValue([REC([{ text: 'Book venue', owner: 'Ben' }, { text: 'Done thing', done: true }])])
      const [p] = await plan()
      const ts = Math.floor(p.startsAt.getTime() / 1000)
      expect(p.message).toBe(`**Ops call agenda** (starts <t:${ts}:R>)\n- Top priority: Ship thing\n- From last call: Book venue (Ben)\nCrew page: ${p.crewUrl}`)
      expect(p.review).toBeUndefined()
      expect(prisma.callRecording.findMany).toHaveBeenCalledTimes(1)
    })

    it('on: the block comes before the tasks, with no "From last call" bullets', async () => {
      on()
      vi.mocked(prisma.callRecording.findMany).mockResolvedValue([
        REC([{ text: 'Draft guide', owner: 'Ana', done: true, evidence: [{ url: 'https://github.com/o/r/pull/12' }] }, { text: 'Book venue', owner: 'Ben' }]),
      ])
      const [p] = await plan()
      const lines = p.message.split('\n')
      expect(lines[1]).toMatch(/^\*\*Since last call\*\* \(<t:\d+:d>\)$/)
      expect(lines.slice(2, 4)).toEqual(['✅ Draft guide (owner: Ana): [PR #12](<https://github.com/o/r/pull/12>)', '- Book venue (owner: Ben)'])
      expect(lines.slice(4)).toEqual(['**Up next**', '- Top priority: Ship thing', `Crew page: ${p.crewUrl}`])
      expect(p.message).not.toContain('From last call')
    })

    it('on, no urgent tasks: the agenda still posts with just the block', async () => {
      on()
      vi.mocked(fetchOpenCrewTasksForCrew).mockResolvedValue({ tasks: [], error: false })
      vi.mocked(prisma.callRecording.findMany).mockResolvedValue([REC([{ text: 'Book venue' }])])
      const r = await runCallAgenda({ now: NOW, fetchImpl: fetchEvents })
      expect(r.outcomes[0].status).toBe('posted')
      const body = vi.mocked(postDiscordMessage).mock.calls[0][1]
      expect(body.content).toContain('**Since last call**')
      expect(body.content).not.toContain('Up next')
    })

    it('on, nothing to review and nothing urgent: still no-items', async () => {
      on()
      vi.mocked(fetchOpenCrewTasksForCrew).mockResolvedValue({ tasks: [], error: false })
      const r = await runCallAgenda({ now: NOW, fetchImpl: fetchEvents })
      expect(r.outcomes[0].status).toBe('no-items')
    })

    it('on, the review load fails: the agenda still posts without the block', async () => {
      on()
      vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.mocked(prisma.callRecording.findMany).mockRejectedValue(new Error('db down'))
      const [p] = await plan()
      expect(p.review).toBeUndefined()
      expect(p.message).toContain('Top priority: Ship thing')
    })

    it('a stale-redaction call is left out and noted for the preview', async () => {
      on()
      vi.mocked(prisma.callRecording.findMany).mockResolvedValue([REC([{ text: 'Book venue' }], { redactionsUpdatedAt: new Date('2026-10-28T00:00:00Z') })])
      const [p] = await plan()
      expect(p.reviewNote).toBe('stale-redactions')
      expect(p.message).not.toContain('Since last call')
    })

    it('review items dropped by the post filter are counted in filteredOut', async () => {
      on()
      setFilter({ blockedTerms: ['venue'] })
      vi.mocked(prisma.callRecording.findMany).mockResolvedValue([REC([{ text: 'Book venue' }, { text: 'Send deck' }])])
      const [p] = await plan()
      expect(p.filteredOut).toBe(1)
      expect(p.message).toContain('Send deck')
      expect(p.message).not.toContain('venue')
    })

    it('two events for one crew read the recordings once for the review', async () => {
      on()
      const two = [
        { id: '111111111111111111', name: 'Ops Call', channel_id: '823956905739026442', status: 1, scheduled_start_time: '2026-10-29T15:20:00Z' },
        { id: '555555555555555555', name: 'Ops Call', channel_id: '823956905739026442', status: 1, scheduled_start_time: '2026-10-29T15:25:00Z' },
      ]
      vi.mocked(getCrewMappings).mockResolvedValue({
        cached: false,
        crews: [{ id: 'ops', label: 'Ops', turtles: [], event: '111111111111111111,555555555555555555', channel: '555555555555555555', sheet: 'https://docs.google.com/spreadsheets/d/abc/edit' }],
      })
      vi.mocked(prisma.callRecording.findMany).mockResolvedValue([REC([{ text: 'Book venue' }])])
      const { planAgendas } = await import('./run')
      const plans = await planAgendas({ now: NOW, horizonMs: 30 * 60 * 1000, fetchImpl: (async () => ({ ok: true, status: 200, json: async () => two })) as unknown as typeof fetch })
      // Review: one findMany per crew; the old follow-up lookup runs per event.
      const reviewCalls = vi.mocked(prisma.callRecording.findMany).mock.calls.filter(([a]) => (a as { select?: { redactionsUpdatedAt?: boolean } }).select?.redactionsUpdatedAt)
      if (plans.length === 2) expect(reviewCalls).toHaveLength(1)
      else expect(reviewCalls.length).toBeLessThanOrEqual(1)
    })

    it('cron path skips the review for an occurrence that is already posted; the preview still loads it', async () => {
      on()
      vi.mocked(prisma.callAgendaPost.findFirst).mockResolvedValue({ id: 'x' } as never)
      vi.mocked(prisma.callRecording.findMany).mockResolvedValue([REC([{ text: 'Book venue' }])])
      await runCallAgenda({ now: NOW, fetchImpl: fetchEvents })
      expect(vi.mocked(prisma.callRecording.findMany).mock.calls.filter(([a]) => (a as { select?: { redactionsUpdatedAt?: boolean } }).select?.redactionsUpdatedAt)).toHaveLength(0)
      const [p] = await plan()
      expect(p.review).toBeDefined()
    })

    it('the Telegram copy shows (label) instead of the masked link', async () => {
      on()
      vi.mocked(prisma.callRecording.findMany).mockResolvedValue([REC([{ text: 'Draft guide', done: true, evidence: [{ url: 'https://github.com/o/r/pull/12' }] }])])
      const [p] = await plan()
      const { toPlainPost } = await vi.importActual<typeof import('@/app/lib/telegram/city-posts')>('@/app/lib/telegram/city-posts')
      const plain = toPlainPost(p.message)
      expect(plain).toContain('(PR #12)')
      expect(plain).not.toContain('](<')
    })
  })
})

describe('formatAgendaMessage with a review block', () => {
  const START = new Date('2026-10-22T15:00:00Z')
  const long = (c: string) => c.repeat(150)
  const items = (n: number, withLink = true) =>
    Array.from({ length: n }, (_, i) => ({ marker: '✅' as const, text: `${i} ${long('x')} (owner: ${'o'.repeat(40)})`, ...(withLink ? { link: `[PR #${i}](<https://github.com/o/r/pull/${i}>)` } : {}) }))
  const bullets = Array.from({ length: 7 }, (_, i) => ({ kind: 'priority' as const, text: `High priority: ${i} ${'t'.repeat(110)}` }))
  const base = { crewLabel: 'Ops', startsAt: NOW, crewUrl: 'https://x/crew/ops' }
  const review = (n: number, more = 0) => ({ startedAt: START, items: items(n), more, moreUrl: 'https://x/calls/rec1' })

  it('stays within 2000 characters with maximum fixtures, keeping heading and crew link', () => {
    const m = formatAgendaMessage({ ...base, bullets, review: review(8) })
    expect(m.length).toBeLessThanOrEqual(2000)
    expect(m.split('\n')[0]).toContain('Ops call agenda')
    expect(m.split('\n').at(-1)).toBe('Crew page: https://x/crew/ops')
  })

  it('gives up links first, then items from the end, then task bullets', () => {
    const count = (m: string, c: string) => m.split('\n').filter((l) => l.startsWith(c)).length
    // Links alone push it over: links go from the last item upward until it fits, every item stays.
    const linksOut = formatAgendaMessage({ ...base, bullets: [], review: review(8) })
    expect(linksOut.length).toBeLessThanOrEqual(2000)
    expect(linksOut).toContain('[PR #0]')
    expect(linksOut).not.toContain('[PR #7]')
    expect(count(linksOut, '✅')).toBe(8)
    expect(linksOut).not.toContain('more:')
    // Longer items: links go, then items from the end; the "+N more" line carries the call page URL.
    const itemsOut = formatAgendaMessage({ ...base, bullets: [], review: { ...review(8), items: items(8).map((i) => ({ ...i, text: i.text + 'q'.repeat(120) })) } })
    expect(itemsOut.length).toBeLessThanOrEqual(2000)
    expect(itemsOut).not.toContain('](<')
    const kept = count(itemsOut, '✅')
    expect(kept).toBeLessThan(8)
    expect(itemsOut).toContain(`+${8 - kept} more: https://x/calls/rec1`)
    // Task bullets go last, from the end: only when no review item is left to drop.
    const long = Array.from({ length: 7 }, (_, i) => ({ kind: 'priority' as const, text: `High priority: ${i} ${'t'.repeat(400)}` }))
    const tasksOut = formatAgendaMessage({ ...base, bullets: long, review: { ...review(0), more: 5 } })
    expect(tasksOut.length).toBeLessThanOrEqual(2000)
    expect(tasksOut).toContain('+5 more:')
    expect(tasksOut).toContain('High priority: 0')
    expect(tasksOut).not.toContain('High priority: 6')
    // With both: the review items go before any task does.
    const both = formatAgendaMessage({ ...base, bullets: long.slice(0, 2), review: { ...review(8), items: items(8) } })
    expect(both).toContain('High priority: 1')
  })

  it('shows the +N more line with the call page url and the sub-heading only with both parts', () => {
    const a = formatAgendaMessage({ ...base, bullets: [], review: review(2, 3) })
    expect(a).toContain('+3 more: https://x/calls/rec1')
    expect(a).not.toContain('Up next')
    const b = formatAgendaMessage({ ...base, bullets: bullets.slice(0, 1), review: review(2) })
    expect(b).toContain('**Up next**')
  })
})
