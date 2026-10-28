// @vitest-environment node
// calzone-30418: ingest auth/validation, DPR gating, no opt-out, crew mapping, reject (hide).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/app/lib/db')
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: vi.fn() }))
vi.mock('@/app/lib/crew-mappings', () => ({ getCrewMappings: vi.fn() }))
vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/app/lib/mission-review-access', () => ({
  isDreadPizzaRoberts: vi.fn(),
}))
vi.mock('./r2', () => ({
  signedAudioUrl: vi.fn(async (k: string) => `https://r2.example/${k}?sig=1`),
  SIGNED_URL_TTL_SEC: 900,
}))

import { prisma } from '@/app/lib/db'
import { signedAudioUrl } from './r2'
import { getCrewMappings } from '@/app/lib/crew-mappings'
import { getSession } from '@/app/lib/session'
import { isDreadPizzaRoberts } from '@/app/lib/mission-review-access'
import { parseIngestPayload } from './ingest-schema'
import { extractEventId, resolveCrewForEvent } from './crew-map'
import { isRecorderAuthorized } from './recorder-auth'
import { POST as ingestPOST } from '@/app/api/calls/recorder/ingest/route'
import { GET as audioGET } from '@/app/api/admin/calls/[id]/audio/route'
import { POST as rejectPOST } from '@/app/api/admin/calls/[id]/remove/route'
import { handleInteraction, type HandlerDeps } from '@/app/lib/discord-interactions/handle'

const m = (f: unknown) => f as ReturnType<typeof vi.fn>
const env = (o: Record<string, string> = {}) => o as NodeJS.ProcessEnv
const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>

const SESSION = 'ev1394003497153724497-1760000000000'
const payload = (over: Record<string, unknown> = {}) => ({
  sessionId: SESSION,
  eventId: '1394003497153724497',
  eventName: 'Community Call',
  channelId: '823956905739026442',
  startedAt: '2026-10-18T17:00:00.000Z',
  endedAt: '2026-10-18T18:00:00.000Z',
  endReason: 'empty',
  mix: { key: `calls/${SESSION}/mix.m4a`, bytes: 1234 },
  speakers: [
    { discordId: '111111111111111111', displayName: 'Ann', talkTimeSec: 600, trackKey: `calls/${SESSION}/tracks/111111111111111111.ogg`, trackBytes: 99 },
  ],
  ...over,
})

const jsonReq = (path: string, body: unknown, auth?: string) =>
  new NextRequest(`https://app.pizzadao.org${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
  })

let savedKey: string | undefined
beforeEach(() => {
  vi.clearAllMocks()
  savedKey = process.env.RECORDER_API_KEY
  process.env.RECORDER_API_KEY = 'rec-key'
})
afterEach(() => {
  if (savedKey === undefined) delete process.env.RECORDER_API_KEY
  else process.env.RECORDER_API_KEY = savedKey
})

describe('isRecorderAuthorized', () => {
  it('requires the exact bearer token and fails closed without a key', () => {
    expect(isRecorderAuthorized('Bearer rec-key')).toBe(true)
    expect(isRecorderAuthorized('Bearer rec-kex')).toBe(false)
    expect(isRecorderAuthorized('Bearer rec-key-longer')).toBe(false)
    expect(isRecorderAuthorized('rec-key')).toBe(false)
    expect(isRecorderAuthorized(null)).toBe(false)
    expect(isRecorderAuthorized('Bearer ', env())).toBe(false)
    expect(isRecorderAuthorized('Bearer undefined', env())).toBe(false)
  })
})

describe('parseIngestPayload', () => {
  it('accepts a full payload', () => {
    const p = parseIngestPayload(payload())
    expect(p.sessionId).toBe(SESSION)
    expect(p.speakers[0].talkTimeSec).toBe(600)
    expect(p.mix?.key).toBe(`calls/${SESSION}/mix.m4a`)
    expect(p.startedAt).toBeInstanceOf(Date)
  })

  it.each([
    ['non-object', 'nope'],
    ['bad session id', payload({ sessionId: 'a b' })],
    ['bad channel', payload({ channelId: 'abc' })],
    ['bad event id', payload({ eventId: 'abc' })],
    ['bad date', payload({ startedAt: 'yesterday' })],
    ['end before start', payload({ endedAt: '2026-10-18T16:00:00.000Z' })],
    ['over 24h', payload({ endedAt: '2026-10-20T18:00:00.000Z' })],
    ['mix key outside the session prefix', payload({ mix: { key: 'calls/other/mix.m4a', bytes: 1 } })],
    ['key traversal', payload({ mix: { key: `calls/${SESSION}/../x`, bytes: 1 } })],
    ['speakers not an array', payload({ speakers: {} })],
    ['speaker bad id', payload({ speakers: [{ discordId: 'x', talkTimeSec: 1 }] })],
    ['duplicate speakers', payload({ speakers: [{ discordId: '111111111111111111' }, { discordId: '111111111111111111' }] })],
    ['negative talk time', payload({ speakers: [{ discordId: '111111111111111111', talkTimeSec: -5 }] })],
  ])('rejects %s', (_n, body) => {
    expect(() => parseIngestPayload(body)).toThrow()
  })
})

describe('POST /api/calls/recorder/ingest', () => {
  it('401 without or with the wrong bearer, and touches nothing', async () => {
    expect((await ingestPOST(jsonReq('/api/calls/recorder/ingest', payload()))).status).toBe(401)
    expect((await ingestPOST(jsonReq('/api/calls/recorder/ingest', payload(), 'Bearer nope'))).status).toBe(401)
    expect(db.callRecording.findUnique).not.toHaveBeenCalled()
    expect(db.callRecording.create).not.toHaveBeenCalled()
  })

  it('400 on an invalid body', async () => {
    const res = await ingestPOST(jsonReq('/api/calls/recorder/ingest', payload({ channelId: 'x' }), 'Bearer rec-key'))
    expect(res.status).toBe(400)
  })

  it('creates the recording with the crew mapped from the event', async () => {
    db.callRecording.findUnique.mockResolvedValue(null)
    db.callRecording.create.mockResolvedValue({ id: 'rec1' })
    m(getCrewMappings).mockResolvedValue({
      cached: true,
      crews: [
        { id: 'ops', label: 'Ops', event: '111111111111111111' },
        { id: 'community_call', label: 'Community Call', event: 'https://discord.com/events/812097286003359764/1394003497153724497' },
      ],
    })
    const res = await ingestPOST(jsonReq('/api/calls/recorder/ingest', payload(), 'Bearer rec-key'))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({
      id: 'rec1',
      duplicate: false,
      keys: [`calls/${SESSION}/mix.m4a`, `calls/${SESSION}/tracks/111111111111111111.ogg`],
    })
    const data = db.callRecording.create.mock.calls[0][0].data
    expect(data).toMatchObject({ sessionId: SESSION, crewId: 'community_call', crewLabel: 'Community Call', durationSec: 3600 })
    expect(data.speakers.create[0]).toMatchObject({ discordId: '111111111111111111', talkTimeSec: 600 })
  })

  it('is idempotent on sessionId', async () => {
    db.callRecording.findUnique.mockResolvedValue({ id: 'rec1', mixKey: 'calls/s/mix.m4a', speakers: [{ trackKey: 'calls/s/tracks/1.ogg' }, { trackKey: null }] })
    const res = await ingestPOST(jsonReq('/api/calls/recorder/ingest', payload(), 'Bearer rec-key'))
    expect(res.status).toBe(200)
    // a duplicate returns the EXISTING row's keys so the worker only prunes objects outside them
    expect(await res.json()).toEqual({ id: 'rec1', duplicate: true, keys: ['calls/s/mix.m4a', 'calls/s/tracks/1.ogg'] })
    expect(db.callRecording.create).not.toHaveBeenCalled()
  })

  it('still stores the recording (no crew) when the crew sheet is down', async () => {
    db.callRecording.findUnique.mockResolvedValue(null)
    db.callRecording.create.mockResolvedValue({ id: 'rec2' })
    m(getCrewMappings).mockRejectedValue(new Error('sheet down'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const res = await ingestPOST(jsonReq('/api/calls/recorder/ingest', payload(), 'Bearer rec-key'))
    expect(res.status).toBe(201)
    expect(db.callRecording.create.mock.calls[0][0].data.crewId).toBeNull()
  })
})

describe('crew mapping', () => {
  const crews = [
    { id: 'ops', label: 'Ops', event: '1111111111111111111' },
    { id: 'design_art', label: 'Design & Art', event: '' },
    { id: 'community_call', label: 'Community Call', event: 'https://discord.com/events/812097286003359764/1394003497153724497' },
  ]
  it('extracts the id from a bare id or an event link', () => {
    expect(extractEventId('1394003497153724497')).toBe('1394003497153724497')
    expect(extractEventId(crews[2].event)).toBe('1394003497153724497')
    expect(extractEventId('')).toBeNull()
    expect(extractEventId('soon')).toBeNull()
  })
  it('matches by event id first', () => {
    expect(resolveCrewForEvent(crews, { eventId: '1111111111111111111', eventName: 'whatever' })).toEqual({ crewId: 'ops', crewLabel: 'Ops' })
    expect(resolveCrewForEvent(crews, { eventId: '1394003497153724497' })?.crewId).toBe('community_call')
  })
  it('falls back to the event name, including date-suffixed names', () => {
    expect(resolveCrewForEvent(crews, { eventId: '5', eventName: 'Design & Art' })?.crewId).toBe('design_art')
    expect(resolveCrewForEvent(crews, { eventName: 'Community Call - Oct 18' })?.crewId).toBe('community_call')
  })
  it('returns null when nothing matches', () => {
    expect(resolveCrewForEvent(crews, { eventId: '5', eventName: 'Pizza party' })).toBeNull()
    expect(resolveCrewForEvent(crews, {})).toBeNull()
  })
})

describe('no recording opt-out (Snax, 2026-10-25)', () => {
  it('the optouts route is gone and /record is not registered', async () => {
    const fs = await import('node:fs')
    expect(fs.existsSync('app/api/calls/recorder/optouts/route.ts')).toBe(false)
    const { PEP_COMMANDS } = await import('@/app/lib/discord-interactions/commands')
    expect(PEP_COMMANDS.map((c) => c.name)).not.toContain('record')
  })
  it('a stale /record invocation is an unknown command', async () => {
    const out = await handleInteraction(
      { type: 2, guild_id: '812097286003359764', member: { user: { id: '42' }, roles: [] }, data: { name: 'record', options: [{ name: 'optout', type: 1, value: undefined }] } },
      { guildId: '812097286003359764' } as unknown as HandlerDeps,
    )
    expect(JSON.stringify(out)).toMatch(/Unknown command/)
  })
})

describe('GET /api/admin/calls/[id]/audio (Dread Pizza Roberts only)', () => {
  const ctx = { params: Promise.resolve({ id: 'rec1' }) }
  const call = () => audioGET(new Request('https://app.pizzadao.org/api/admin/calls/rec1/audio'), ctx)
  const rec = (over: Record<string, unknown> = {}) => ({
    id: 'rec1',
    endedAt: new Date(),
    audioDeletedAt: null,
    mixKey: 'calls/s/mix.m4a',
    speakers: [{ discordId: '1', displayName: 'Ann', trackKey: 'calls/s/tracks/1.ogg' }],
    ...over,
  })

  it('401 without a session', async () => {
    m(getSession).mockResolvedValue(null)
    expect((await call()).status).toBe(401)
  })
  it('403 for a signed-in non-DPR member, with no R2 access', async () => {
    m(getSession).mockResolvedValue({ discordId: '9' })
    m(isDreadPizzaRoberts).mockResolvedValue(false)
    const res = await call()
    expect(res.status).toBe(403)
    expect(isDreadPizzaRoberts).toHaveBeenCalledWith('9') // the L8 (DPR-only) gate
    expect(db.callRecording.findUnique).not.toHaveBeenCalled()
  })
  it('returns signed URLs for a reviewer', async () => {
    m(getSession).mockResolvedValue({ discordId: '9' })
    m(isDreadPizzaRoberts).mockResolvedValue(true)
    db.callRecording.findUnique.mockResolvedValue(rec())
    const body = await (await call()).json()
    expect(body.mix).toContain('calls/s/mix.m4a')
    expect(body.tracks[0].url).toContain('calls/s/tracks/1.ogg')
    expect(body.expiresInSec).toBe(900)
  })
  it('404 for an unknown recording', async () => {
    m(getSession).mockResolvedValue({ discordId: '9' })
    m(isDreadPizzaRoberts).mockResolvedValue(true)
    db.callRecording.findUnique.mockResolvedValue(null)
    expect((await call()).status).toBe(404)
  })
  it('410 only when the recording has no stored audio, however old it is', async () => {
    m(getSession).mockResolvedValue({ discordId: '9' })
    m(isDreadPizzaRoberts).mockResolvedValue(true)
    db.callRecording.findUnique.mockResolvedValue(rec({ mixKey: null, speakers: [{ discordId: '1', displayName: 'Ann', trackKey: null }] }))
    expect((await call()).status).toBe(410)
    db.callRecording.findUnique.mockResolvedValue(rec({ endedAt: new Date(Date.now() - 400 * 86_400_000) }))
    expect((await call()).status).toBe(200) // kept forever
  })
})

describe('POST /api/admin/calls/[id]/remove (reject / hide)', () => {
  const ctx = { params: Promise.resolve({ id: 'rec1' }) }
  const call = (body: unknown = { confirm: true }) =>
    rejectPOST(
      new Request('https://app.pizzadao.org/api/admin/calls/rec1/remove', { method: 'POST', body: JSON.stringify(body) }),
      ctx,
    )
  const asReviewer = () => {
    m(getSession).mockResolvedValue({ discordId: '9' })
    m(isDreadPizzaRoberts).mockResolvedValue(true)
  }

  it('401 without a session and 403 for a non-reviewer, changing nothing', async () => {
    m(getSession).mockResolvedValue(null)
    expect((await call()).status).toBe(401)
    m(getSession).mockResolvedValue({ discordId: '9' })
    m(isDreadPizzaRoberts).mockResolvedValue(false)
    expect((await call()).status).toBe(403)
    expect(db.callRecording.update).not.toHaveBeenCalled()
  })

  it('400 unless confirm is exactly true', async () => {
    asReviewer()
    expect((await call({})).status).toBe(400)
    expect((await call({ confirm: 'yes' })).status).toBe(400)
    expect(db.callRecording.update).not.toHaveBeenCalled()
  })

  it('404 for an unknown id', async () => {
    asReviewer()
    db.callRecording.findUnique.mockResolvedValue(null)
    expect((await call()).status).toBe(404)
    expect(db.callRecording.update).not.toHaveBeenCalled()
  })

  it('marks REJECTED with reviewedBy/reviewedAt in one update; audio keys, row and speakers untouched; no R2 calls', async () => {
    asReviewer()
    db.callRecording.findUnique.mockResolvedValue({ id: 'rec1' })
    expect((await call()).status).toBe(200)
    expect(db.callRecording.update).toHaveBeenCalledTimes(1)
    const arg = db.callRecording.update.mock.calls[0][0]
    expect(arg.where).toEqual({ id: 'rec1' })
    expect(arg.data).toMatchObject({ status: 'REJECTED', reviewedBy: '9', publishedAt: null })
    expect(arg.data.reviewedAt).toBeInstanceOf(Date)
    expect(Object.keys(arg.data).sort()).toEqual(['publishedAt', 'reviewedAt', 'reviewedBy', 'status'])
    expect(db.callRecording.delete).not.toHaveBeenCalled()
    expect(db.callSpeaker.deleteMany).not.toHaveBeenCalled()
    expect(signedAudioUrl).not.toHaveBeenCalled() // nothing in R2 was touched
  })
})
