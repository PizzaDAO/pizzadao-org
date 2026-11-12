import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const { rows, prismaMock, eventReq, postFile, enqueue } = vi.hoisted(() => {
const rows: Row[] = []
const prismaMock = {
  crewSession: {
    findUnique: vi.fn(async ({ where }: { where: { crewId_dedupeKey: { crewId: string; dedupeKey: string } } }) =>
      rows.find((r) => r.crewId === where.crewId_dedupeKey.crewId && r.dedupeKey === where.crewId_dedupeKey.dedupeKey) ?? null),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const r = { id: `s${rows.length + 1}`, eventId: null, announceMessageId: null, generalMessageId: null, telegramQueued: false, ...data }
      rows.push(r)
      return r
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
      const hits = rows.filter((r) => Object.entries(where).every(([k, v]) => r[k] === v))
      hits.forEach((r) => Object.assign(r, data))
      return { count: hits.length }
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
      const r = rows.find((x) => x.id === where.id)!
      Object.assign(r, data)
      return r
    }),
  },
}
const eventReq = vi.fn(async () => ({ id: '999001' }))
const postFile = vi.fn(async (t: { channelId: string }) => ({ id: `m-${t.channelId}` }))
const enqueue = vi.fn(async () => ({ queued: 1 }))
return { rows, prismaMock, eventReq, postFile, enqueue }
})
vi.mock('@/app/lib/db', () => ({ prisma: prismaMock }))
vi.mock('@/app/lib/discord-channels', () => ({ getGuildChannels: vi.fn(async () => [{ id: '111111', name: 'talks', type: 2 }]) }))
vi.mock('@/app/lib/discord-rest', async (orig) => ({ ...(await orig<typeof import('@/app/lib/discord-rest')>()), discordScheduledEventRequest: eventReq }))
vi.mock('./discord-file', () => ({ postMessageWithFile: postFile }))
vi.mock('@/app/lib/telegram/city-posts', () => ({ enqueueMirror: enqueue }))

import { DiscordPostError } from '@/app/lib/discord-rest'
import { parseSessionInput } from './build'
import { scheduleEducationSession } from './run'

const session = parseSessionInput(
  { title: 'Intro', presenter: 'P', description: 'D', date: '2026-11-20', time: '18:30', timeZone: 'UTC', lengthMinutes: 60 },
  new Date('2026-11-11T00:00:00Z'),
)
const env = { DISCORD_BOT_TOKEN: 't', DISCORD_GUILD_ID: '555555' } as unknown as NodeJS.ProcessEnv
const channels: Record<string, string> = { 'discord.educationEventChannelId': '111111', 'discord.educationChannelId': '222222', 'discord.educationGeneralChannelId': '' }
const deps = (over = {}) => ({ enabled: async () => true, channelId: async (k: string) => channels[k] ?? '', flyer: async () => Buffer.from('png'), env, ...over }) as never

beforeEach(() => {
  rows.length = 0
  vi.clearAllMocks()
  channels['discord.educationGeneralChannelId'] = ''
})

describe('scheduleEducationSession', () => {
  it('does nothing and creates no row when switched off', async () => {
    const r = await scheduleEducationSession(session, 'u1', deps({ enabled: async () => false }))
    expect(r.status).toBe('disabled')
    expect(rows).toHaveLength(0)
    expect(eventReq).not.toHaveBeenCalled()
    expect(postFile).not.toHaveBeenCalled()
  })

  it('creates the event with the flyer, posts with no mentions, queues Telegram', async () => {
    const r = await scheduleEducationSession(session, 'u1', deps())
    expect(r).toMatchObject({ status: 'scheduled', event: 'done', announcement: 'done', general: 'skipped', telegram: 'done', eventUrl: 'https://discord.com/events/555555/999001' })
    const body = (eventReq.mock.calls[0] as unknown as [{ method: string; body: { image: string; channel_id: string } }])[0]
    expect(body.method).toBe('POST')
    expect(body.body.image).toMatch(/^data:image\/png;base64,/)
    expect(postFile).toHaveBeenCalledTimes(1)
    const msg = (postFile.mock.calls[0] as unknown as [unknown, { allowed_mentions: unknown; content: string }])[1]
    expect(msg.allowed_mentions).toEqual({ parse: [] })
    expect(msg.content).toContain('discord.com/events/555555/999001')
    expect(rows[0]).toMatchObject({ eventId: '999001', announceMessageId: 'm-222222', createdBy: 'u1' })
  })

  it('posts to the general channel only when configured', async () => {
    channels['discord.educationGeneralChannelId'] = '333333'
    const r = await scheduleEducationSession(session, 'u1', deps())
    expect(r.general).toBe('done')
    expect(postFile).toHaveBeenCalledTimes(2)
  })

  it('is idempotent: a second submit creates and posts nothing more', async () => {
    await scheduleEducationSession(session, 'u1', deps())
    const r = await scheduleEducationSession(session, 'u2', deps())
    expect(r.status).toBe('already')
    expect(r).toMatchObject({ event: 'already', announcement: 'already', telegram: 'already' })
    expect(rows).toHaveLength(1)
    expect(eventReq).toHaveBeenCalledTimes(1)
    expect(postFile).toHaveBeenCalledTimes(1)
    expect(enqueue).toHaveBeenCalledTimes(1)
  })

  it('a failed step is retried on the next submit without redoing the done ones', async () => {
    postFile.mockRejectedValueOnce(new DiscordPostError('Missing Access', 403))
    const first = await scheduleEducationSession(session, 'u1', deps())
    expect(first).toMatchObject({ status: 'partial', event: 'done', announcement: 'failed' })
    expect(rows[0].announceMessageId).toBeNull()
    const second = await scheduleEducationSession(session, 'u1', deps())
    expect(second).toMatchObject({ event: 'already', announcement: 'done' })
    expect(eventReq).toHaveBeenCalledTimes(1)
  })

  it('an uncertain failure (5xx) keeps the claim so it is never double posted', async () => {
    postFile.mockRejectedValueOnce(new DiscordPostError('boom', 502))
    const first = await scheduleEducationSession(session, 'u1', deps())
    expect(first.announcement).toBe('uncertain')
    const second = await scheduleEducationSession(session, 'u1', deps())
    expect(second.announcement).toBe('uncertain')
    expect(postFile).toHaveBeenCalledTimes(1)
  })

  it('not configured: no channels set', async () => {
    const r = await scheduleEducationSession(session, 'u1', deps({ channelId: async () => '' }))
    expect(r.status).toBe('not-configured')
    expect(rows).toHaveLength(0)
  })
})
