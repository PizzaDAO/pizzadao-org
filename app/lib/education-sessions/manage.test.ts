import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const { rows, prismaMock, eventReq, postFile, editFile, editMsg, postMsg, enqueue } = vi.hoisted(() => {
  const rows: Row[] = []
  const match = (r: Row, where: Row) =>
    Object.entries(where).every(([k, v]) => (v && typeof v === 'object' && 'not' in (v as object) ? r[k] !== (v as { not: unknown }).not : r[k] === v))
  const prismaMock = {
    crewSession: {
      findUnique: vi.fn(async ({ where }: { where: Row }) => {
        const k = where.crewId_dedupeKey as { crewId: string; dedupeKey: string } | undefined
        return rows.find((r) => (k ? r.crewId === k.crewId && r.dedupeKey === k.dedupeKey : r.id === where.id)) ?? null
      }),
      create: vi.fn(async ({ data }: { data: Row }) => {
        const r = { id: `s${rows.length + 1}`, eventId: null, announceMessageId: null, generalMessageId: null, telegramQueued: false, status: 'SCHEDULED', canceledAt: null, public: true, recordingUrl: null, ...data }
        rows.push(r)
        return r
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const hits = rows.filter((r) => match(r, where))
        hits.forEach((r) => Object.assign(r, data))
        return { count: hits.length }
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
        const r = rows.find((x) => x.id === where.id)!
        if (data.dedupeKey && rows.some((o) => o !== r && o.crewId === r.crewId && o.dedupeKey === data.dedupeKey)) throw Object.assign(new Error('dup'), { code: 'P2002' })
        Object.assign(r, data)
        return r
      }),
    },
  }
  return {
    rows,
    prismaMock,
    eventReq: vi.fn(async (..._a: unknown[]) => ({ id: '999001' })),
    postFile: vi.fn(async (t: { channelId: string }, ..._a: unknown[]) => ({ id: `m-${t.channelId}` })),
    editFile: vi.fn(async (..._a: unknown[]) => undefined),
    editMsg: vi.fn(async (..._a: unknown[]) => undefined),
    postMsg: vi.fn(async (..._a: unknown[]) => ({ id: 'reply1' })),
    enqueue: vi.fn(async () => ({ queued: 1 })),
  }
})
vi.mock('@/app/lib/db', () => ({ prisma: prismaMock }))
vi.mock('@/app/lib/discord-channels', () => ({ getGuildChannels: vi.fn(async () => [{ id: '111111', name: 'talks', type: 2 }]) }))
vi.mock('@/app/lib/discord-rest', async (orig) => ({
  ...(await orig<typeof import('@/app/lib/discord-rest')>()),
  discordScheduledEventRequest: eventReq,
  editDiscordMessage: editMsg,
  postDiscordMessage: postMsg,
}))
vi.mock('./discord-file', () => ({ postMessageWithFile: postFile, editMessageWithFile: editFile }))
vi.mock('@/app/lib/telegram/city-posts', () => ({ enqueueMirror: enqueue }))

import { DiscordPostError } from '@/app/lib/discord-rest'
import { parseSessionInput } from './build'
import { cancelSession, editSession, retrySession, scheduleEducationSession } from './run'

const NOW = new Date('2026-11-11T00:00:00Z')
const input = { title: 'Intro', presenter: 'P', description: 'D', date: '2026-11-20', time: '18:30', timeZone: 'UTC', lengthMinutes: 60 }
const session = parseSessionInput(input, NOW)
const extras = { public: true, recordingUrl: null }
const env = { DISCORD_BOT_TOKEN: 't', DISCORD_GUILD_ID: '555555' } as unknown as NodeJS.ProcessEnv
const channels: Record<string, string> = { 'discord.educationEventChannelId': '111111', 'discord.educationChannelId': '222222', 'discord.educationGeneralChannelId': '' }
const deps = (over = {}) => ({ enabled: async () => true, editEnabled: async () => true, channelId: async (k: string) => channels[k] ?? '', flyer: vi.fn(async () => Buffer.from('png')), env, ...over }) as never

beforeEach(() => {
  rows.length = 0
  vi.clearAllMocks()
  channels['discord.educationGeneralChannelId'] = ''
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => vi.useRealTimers())

describe('editSession: edit in place', () => {
  it('PATCHes the same event and message: no second event, no second post, one row', async () => {
    await scheduleEducationSession('education', session, 'u1', deps(), extras)
    const fixed = parseSessionInput({ ...input, title: 'Intro to Dough', time: '19:00' }, NOW)
    const r = await editSession(rows[0].id as string, fixed, extras, 'u2', {}, deps())

    expect(r).toMatchObject({ status: 'edited', event: 'done', announcement: 'done', general: 'skipped' })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ title: 'Intro to Dough', updatedBy: 'u2' })
    // Created once at schedule time; the edit only ever PATCHes.
    expect(eventReq.mock.calls.map((c) => (c[0] as { method: string }).method)).toEqual(['POST', 'PATCH'])
    const patch = eventReq.mock.calls[1][0] as unknown as { eventId: string; body: Record<string, unknown> }
    expect(patch.eventId).toBe('999001')
    expect(patch.body).toMatchObject({ name: 'Intro to Dough', scheduled_start_time: '2026-11-20T19:00:00.000Z' })
    expect(patch.body.channel_id).toBeUndefined()
    expect(postFile).toHaveBeenCalledTimes(1)
    expect(editFile).toHaveBeenCalledTimes(1)
    const [target, body] = editFile.mock.calls[0] as unknown as [{ channelId: string; messageId: string }, { content: string }]
    expect(target).toMatchObject({ channelId: '222222', messageId: 'm-222222' })
    expect(body.content).toContain('Intro to Dough')
    expect(enqueue).toHaveBeenCalledTimes(1)
  })

  it('submitting the create form again with the NEW values does not make a second session', async () => {
    await scheduleEducationSession('education', session, 'u1', deps(), extras)
    const fixed = parseSessionInput({ ...input, title: 'Intro to Dough' }, NOW)
    await editSession(rows[0].id as string, fixed, extras, 'u1', {}, deps())
    const again = await scheduleEducationSession('education', fixed, 'u1', deps(), extras)
    expect(again.status).toBe('already')
    expect(rows).toHaveLength(1)
    expect(eventReq).toHaveBeenCalledTimes(2) // POST + PATCH, nothing from the re-submit
    expect(postFile).toHaveBeenCalledTimes(1)
  })

  it('keeps working when the new title and time collide with another session', async () => {
    await scheduleEducationSession('education', session, 'u1', deps(), extras)
    const other = parseSessionInput({ ...input, title: 'Other' }, NOW)
    await scheduleEducationSession('education', other, 'u1', deps(), extras)
    const r = await editSession(rows[0].id as string, other, extras, 'u1', {}, deps())
    expect(r.status).toBe('edited')
    expect(rows[0].title).toBe('Other')
  })

  it('does not create a step that failed earlier (Retry does that)', async () => {
    postFile.mockRejectedValueOnce(new DiscordPostError('Missing Access', 403))
    await scheduleEducationSession('education', session, 'u1', deps(), extras)
    expect(rows[0].announceMessageId).toBeNull()
    const r = await editSession(rows[0].id as string, session, extras, 'u1', {}, deps())
    expect(r.announcement).toBe('skipped')
    expect(postFile).toHaveBeenCalledTimes(1)
    expect(editFile).not.toHaveBeenCalled()
  })

  it('a failed Discord edit is reported, not retried as a new post', async () => {
    await scheduleEducationSession('education', session, 'u1', deps(), extras)
    editFile.mockRejectedValueOnce(new DiscordPostError('Unknown Message', 404))
    const r = await editSession(rows[0].id as string, session, extras, 'u1', {}, deps())
    expect(r).toMatchObject({ announcement: 'failed' })
    expect(r.errors?.[0]).toContain('announcement')
    expect(postFile).toHaveBeenCalledTimes(1)
    expect(rows[0].lastError).toContain('announcement')
  })

  it('posts the optional update reply under the announcement, without pings', async () => {
    await scheduleEducationSession('education', session, 'u1', deps(), extras)
    const r = await editSession(rows[0].id as string, session, extras, 'u1', { notify: true }, deps())
    expect(r.note).toBe('done')
    const body = postMsg.mock.calls[0][1] as unknown as { content: string; allowed_mentions: unknown; message_reference: { message_id: string } }
    expect(body.message_reference.message_id).toBe('m-222222')
    expect(body.allowed_mentions).toEqual({ parse: [] })
    expect(body.content).toContain('Updated')
  })

  it('does nothing while editing or posting is switched off', async () => {
    await scheduleEducationSession('education', session, 'u1', deps(), extras)
    expect((await editSession(rows[0].id as string, session, extras, 'u1', {}, deps({ editEnabled: async () => false }))).status).toBe('disabled')
    expect((await editSession(rows[0].id as string, session, extras, 'u1', {}, deps({ enabled: async () => false }))).status).toBe('disabled')
    expect(editFile).not.toHaveBeenCalled()
  })

  it('refuses a canceled, an ended or an unknown session', async () => {
    await scheduleEducationSession('education', session, 'u1', deps(), extras)
    expect((await editSession('nope', session, extras, 'u1', {}, deps())).status).toBe('not-found')
    vi.setSystemTime(new Date('2026-11-21T00:00:00Z'))
    expect((await editSession(rows[0].id as string, session, extras, 'u1', {}, deps())).status).toBe('ended')
    vi.setSystemTime(NOW)
    await cancelSession(rows[0].id as string, 'u1', deps())
    expect((await editSession(rows[0].id as string, session, extras, 'u1', {}, deps())).status).toBe('canceled')
  })

  it('stores the public flag and the recording link', async () => {
    await scheduleEducationSession('education', session, 'u1', deps(), extras)
    await editSession(rows[0].id as string, session, { public: false, recordingUrl: 'https://example.org/r' }, 'u1', {}, deps())
    expect(rows[0]).toMatchObject({ public: false, recordingUrl: 'https://example.org/r' })
  })
})

describe('cancelSession', () => {
  it('cancels the event, edits the announcement, keeps the flyer, deletes nothing', async () => {
    channels['discord.educationGeneralChannelId'] = '333333'
    await scheduleEducationSession('education', session, 'u1', deps(), extras)
    const r = await cancelSession(rows[0].id as string, 'u2', deps())
    expect(r).toMatchObject({ status: 'canceled', alreadyCanceled: false, event: 'done', announcement: 'done', general: 'done' })
    expect(rows[0]).toMatchObject({ status: 'CANCELED', updatedBy: 'u2' })
    expect(rows[0].canceledAt).toBeInstanceOf(Date)
    const ev = eventReq.mock.calls.at(-1)![0] as unknown as { method: string; body: unknown }
    expect(ev).toMatchObject({ method: 'PATCH', body: { status: 4 } })
    expect(editMsg).toHaveBeenCalledTimes(2)
    const [target, body] = editMsg.mock.calls[0] as unknown as [{ messageId: string }, Record<string, unknown>]
    expect(target.messageId).toBe('m-222222')
    expect(String(body.content)).toMatch(/^❌ \*\*Cancelled: Intro/)
    expect(body.attachments).toBeUndefined() // the flyer stays
    expect(body.allowed_mentions).toEqual({ parse: [] })
  })

  it('is repeatable: the row keeps its first cancel time and failed steps are re-run', async () => {
    await scheduleEducationSession('education', session, 'u1', deps(), extras)
    editMsg.mockRejectedValueOnce(new DiscordPostError('boom', 500))
    const first = await cancelSession(rows[0].id as string, 'u1', deps())
    expect(first.announcement).toBe('failed')
    const at = rows[0].canceledAt
    const second = await cancelSession(rows[0].id as string, 'u2', deps())
    expect(second).toMatchObject({ alreadyCanceled: true, announcement: 'done' })
    expect(rows[0].canceledAt).toBe(at)
    expect(rows[0].updatedBy).toBe('u1')
  })

  it('a canceled session cannot be scheduled again by the same form values', async () => {
    await scheduleEducationSession('education', session, 'u1', deps(), extras)
    await cancelSession(rows[0].id as string, 'u1', deps())
    const posts = postFile.mock.calls.length
    const r = await scheduleEducationSession('education', session, 'u1', deps(), extras)
    expect(r.status).toBe('canceled')
    expect(postFile).toHaveBeenCalledTimes(posts)
  })

  it('switched off, unknown or ended', async () => {
    await scheduleEducationSession('education', session, 'u1', deps(), extras)
    expect((await cancelSession(rows[0].id as string, 'u1', deps({ editEnabled: async () => false }))).status).toBe('disabled')
    expect(rows[0].status).toBe('SCHEDULED')
    expect((await cancelSession('nope', 'u1', deps())).status).toBe('not-found')
    vi.setSystemTime(new Date('2026-11-21T00:00:00Z'))
    expect((await cancelSession(rows[0].id as string, 'u1', deps())).status).toBe('ended')
  })
})

describe('retrySession', () => {
  it('posts only the missing step, with the stored (edited) fields', async () => {
    postFile.mockRejectedValueOnce(new DiscordPostError('Missing Access', 403))
    await scheduleEducationSession('education', session, 'u1', deps(), extras)
    await editSession(rows[0].id as string, parseSessionInput({ ...input, title: 'Fixed title' }, NOW), extras, 'u1', {}, deps())
    const r = await retrySession(rows[0].id as string, deps())
    expect(r).toMatchObject({ event: 'already', announcement: 'done' })
    expect(eventReq.mock.calls.filter((c) => (c[0] as { method: string }).method === 'POST')).toHaveLength(1)
    const msg = postFile.mock.calls.at(-1)![1] as unknown as { content: string }
    expect(msg.content).toContain('Fixed title')
  })

  it('refuses canceled, ended and unknown sessions, and respects the kill switch', async () => {
    await scheduleEducationSession('education', session, 'u1', deps(), extras)
    expect((await retrySession('nope', deps())).status).toBe('not-found')
    expect((await retrySession(rows[0].id as string, deps({ enabled: async () => false }))).status).toBe('disabled')
    vi.setSystemTime(new Date('2026-11-21T00:00:00Z'))
    expect((await retrySession(rows[0].id as string, deps())).status).toBe('ended')
    vi.setSystemTime(NOW)
    await cancelSession(rows[0].id as string, 'u1', deps())
    expect((await retrySession(rows[0].id as string, deps())).status).toBe('canceled')
  })
})
