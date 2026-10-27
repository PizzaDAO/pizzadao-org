// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/app/lib/db')
vi.mock('@/app/lib/crew-mappings', () => ({
  getCrewMappings: vi.fn(),
  fetchOpenCrewTasksResult: vi.fn(),
}))
vi.mock('@/app/lib/discord-rest', async (orig) => ({
  ...(await orig<typeof import('@/app/lib/discord-rest')>()),
  postDiscordMessage: vi.fn(),
}))
vi.mock('@/app/lib/discord-channels', async (orig) => ({
  ...(await orig<typeof import('@/app/lib/discord-channels')>()),
  getGuildChannels: vi.fn(),
}))

import { prisma } from '@/app/lib/db'
import { getCrewMappings, fetchOpenCrewTasksResult } from '@/app/lib/crew-mappings'
import { postDiscordMessage, DiscordPostError } from '@/app/lib/discord-rest'
import { getGuildChannels } from '@/app/lib/discord-channels'
import { buildAgendaBullets, daysOverdue, parseActionItems, formatAgendaMessage, agendaTimeZone } from './rank'
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
  it('formatAgendaMessage ends with the crew link', () => {
    const m = formatAgendaMessage({ crewLabel: 'Ops', startsAt: NOW, bullets: [{ kind: 'priority', text: 'Top priority: X' }], crewUrl: 'https://x/crew/ops' })
    expect(m.split('\n').at(-1)).toBe('Crew page: https://x/crew/ops')
    expect(m).toContain('- Top priority: X')
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
    process.env.DISCORD_BOT_TOKEN = 'tok'
    process.env.DISCORD_GUILD_ID = '1'
    process.env.CALL_AGENDA_POST_ENABLED = 'true'
    vi.mocked(getCrewMappings).mockResolvedValue({
      cached: false,
      crews: [{ id: 'ops', label: 'Ops', turtles: [], event: '111111111111111111', channel: '555555555555555555', sheet: 'https://docs.google.com/spreadsheets/d/abc/edit' }],
    })
    vi.mocked(fetchOpenCrewTasksResult).mockResolvedValue({ tasks: [task('Ship thing', { priority: 'Top' })], error: false })
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
    vi.mocked(fetchOpenCrewTasksResult).mockResolvedValue({ tasks: [], error: true })
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
    vi.mocked(fetchOpenCrewTasksResult).mockResolvedValue({ tasks: [], error: false })
    const r = await runCallAgenda({ now: NOW, fetchImpl: fetchEvents })
    expect(r.outcomes[0].status).toBe('no-items')
    expect(prisma.callAgendaPost.create).not.toHaveBeenCalled()
  })
})
