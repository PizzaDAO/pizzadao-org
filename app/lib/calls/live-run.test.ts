// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/lib/db')

import { prisma } from '@/app/lib/db'
import type { Settings } from '@/app/lib/settings'
import { SETTINGS, type SettingKey } from '@/app/lib/settings/registry'
import { EMPTY_POST_FILTER, type PostFilter } from './post-filters'
import { handleLiveRequest, pruneLiveChunks, sweepLiveData, type DetectedItem, type LiveDeps } from './live-run'
import type { LiveRequest } from './live-items'

function fakeSettings(over: Partial<Record<SettingKey, unknown>> = {}, readFailed = false): Settings {
  return {
    readFailed,
    invalidKeys: [],
    isSet: (k) => k in over,
    get: ((k: SettingKey) => (k in over ? over[k] : SETTINGS[k].default)) as Settings['get'],
  }
}

const ON = { 'calls.liveActionItemsEnabled': true, 'calls.chatActionItemsEnabled': true, 'calls.liveActionItemsCrews': 'ops' }
const SID = 'evt1-1700000000000'
const base: LiveRequest = { sessionId: SID, eventId: '100000000000000001', eventName: 'Ops call', startedAt: new Date(0).toISOString() }
const chat = (text: string, messageId = '700000000000000001'): LiveRequest => ({ ...base, chat: [{ discordId: '111111', displayName: 'Ann', messageId, text, atMs: 5000 }] })

const items = vi.mocked(prisma.callLiveItem)
const chunks = vi.mocked(prisma.callLiveChunk)
let stored: Array<{ text: string; posted: boolean }>

function deps(o: { settings?: Record<string, unknown>; filter?: PostFilter | Error; crew?: { crewId: string; crewLabel: string } | null } = {}, extra: Partial<LiveDeps> = {}): LiveDeps {
  return {
    settings: fakeSettings({ ...ON, ...(o.settings ?? {}) } as Partial<Record<SettingKey, unknown>>),
    env: { VERCEL_ENV: 'production', OPENAI_API_KEY: 'sk-test' },
    resolveCrew: async () => (o.crew === undefined ? { crewId: 'ops', crewLabel: 'Ops' } : o.crew),
    postFilter: async () => {
      if (o.filter instanceof Error) throw o.filter
      return o.filter ?? EMPTY_POST_FILTER
    },
    log: () => {},
    ...extra,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  stored = []
  items.findMany.mockImplementation((async () => stored) as never)
  items.create.mockImplementation((async ({ data }: { data: { text: string; posted: boolean } }) => {
    stored.push({ text: data.text, posted: data.posted })
    return data
  }) as never)
  chunks.create.mockResolvedValue({} as never)
  chunks.updateMany.mockResolvedValue({ count: 1 } as never)
  chunks.findMany.mockResolvedValue([] as never)
})

describe('typed action items (option C)', () => {
  it('confirms a prefixed chat line in one short message and stores it', async () => {
    const out = await handleLiveRequest(chat('action: book the venue'), deps())
    expect(out.messages).toEqual(['📝 Action item recorded: book the venue\n-# Added to the call notes for review'])
    expect(items.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ sessionId: SID, source: 'chat', text: 'book the venue', owner: null, speakerIds: ['111111'], messageId: '700000000000000001', posted: true }),
    })
  })

  it('posts nothing when off, for other crews, or when anything cannot be checked', async () => {
    const r = chat('action: book the venue')
    expect((await handleLiveRequest(r, deps({ settings: { 'calls.chatActionItemsEnabled': false } }))).messages).toEqual([])
    expect((await handleLiveRequest(r, deps({ settings: { 'calls.liveActionItemsCrews': '' } }))).messages).toEqual([])
    expect((await handleLiveRequest(r, deps({ crew: { crewId: 'tech', crewLabel: 'Tech' } }))).reason).toBe('crew-not-allowed')
    expect((await handleLiveRequest(r, deps({ crew: null }))).reason).toBe('crew-not-allowed')
    expect((await handleLiveRequest(r, deps({ filter: new Error('db down') }))).reason).toBe('filter-unreadable')
    expect((await handleLiveRequest(r, { ...deps(), settings: fakeSettings(ON as never, true) })).reason).toBe('settings-unreadable')
    expect((await handleLiveRequest(r, { ...deps(), env: { VERCEL_ENV: 'preview' } })).reason).toBe('off')
    expect(items.create).not.toHaveBeenCalled()
  })

  it('applies the private post filter: excluded crews and blocked terms', async () => {
    const excluded = await handleLiveRequest(chat('action: book the venue'), deps({ filter: { ...EMPTY_POST_FILTER, excludedCrewIds: ['ops'] } }))
    expect(excluded.reason).toBe('crew-excluded')
    const blocked = await handleLiveRequest(chat('action: call the secretword people'), deps({ filter: { ...EMPTY_POST_FILTER, blockedTerms: ['secretword'] } }))
    expect(blocked.messages).toEqual([])
    expect(items.create).not.toHaveBeenCalled()
  })

  it('dedupes against items already recorded in the call', async () => {
    stored = [{ text: 'Book the venue', posted: true }]
    const out = await handleLiveRequest(chat('todo: book venue'), deps())
    expect(out.messages).toEqual([])
    expect(items.create).not.toHaveBeenCalled()
  })

  it('stays quiet past the per-call cap but still stores the item', async () => {
    stored = [{ text: 'First task here', posted: true }]
    const out = await handleLiveRequest(chat('action: second distinct thing'), deps({ settings: { 'calls.liveActionItemsMaxPerCall': 1 } }))
    expect(out.messages).toEqual([])
    expect(items.create).toHaveBeenCalledWith({ data: expect.objectContaining({ text: 'second distinct thing', posted: false }) })
  })

  it('a concurrent duplicate (unique violation) is skipped, not posted', async () => {
    items.create.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }))
    expect((await handleLiveRequest(chat('action: book the venue'), deps())).messages).toEqual([])
  })
})

describe('spoken action items (option A)', () => {
  const speech = (seq = 1, key = `calls/${SID}/live/111111/1000.ogg`): LiveRequest => ({
    ...base,
    seq,
    segments: [{ discordId: '111111', displayName: 'Ann', key, startMs: 1000, endMs: 4000 }],
  })
  const audio = (detect = vi.fn(async (): Promise<DetectedItem[]> => [{ text: 'Send the deck to the team', owner: 'S1 (Ann)', speaker: 'S1' }])) => ({
    download: vi.fn(async () => new Uint8Array([1])),
    decode: vi.fn(async (_b: Uint8Array, durMs: number) => new Int16Array(Math.round(durMs * 16))),
    transcribe: vi.fn(async () => ({ language: 'en', segments: [{ start: 0, end: 2.5, text: 'I will send the deck to the team.' }], words: [] })),
    detect,
  })

  it('transcribes the chunk, asks the detector about the new part and confirms what it finds', async () => {
    const a = audio()
    const out = await handleLiveRequest(speech(), deps({}, a))
    expect(a.download).toHaveBeenCalledWith(`calls/${SID}/live/111111/1000.ogg`)
    expect(a.transcribe).toHaveBeenCalledTimes(1)
    expect(chunks.create).toHaveBeenCalledWith({ data: { sessionId: SID, seq: 1, segments: [], segmentKeys: [`calls/${SID}/live/111111/1000.ogg`] } })
    const saved = (chunks.updateMany.mock.calls[0][0] as { data: { segments: Array<{ text: string; startMs: number; name: string }> } }).data.segments
    expect(saved).toEqual([expect.objectContaining({ discordId: '111111', name: 'Ann', text: 'I will send the deck to the team.', startMs: 1000 })])
    const input = (a.detect.mock.calls[0] as unknown[])[0] as { transcript: string; newFrom: string; already: string[] }
    expect(input.newFrom).toBe('00:01')
    expect(input.transcript).toContain('S1 (Ann): I will send the deck to the team.')
    expect(out.messages).toEqual(['📝 Action item recorded: Send the deck to the team — Ann\n-# Added to the call notes for review'])
    expect(items.create).toHaveBeenCalledWith({ data: expect.objectContaining({ source: 'speech', speakerIds: ['111111'], owner: 'Ann', startMs: 1000, endMs: 3500 }) })
  })

  it('never transcribes the same audio twice, whatever seq the recorder sends', async () => {
    chunks.findMany.mockResolvedValueOnce([{ seq: 1, audioMs: 3000, segmentKeys: [`calls/${SID}/live/111111/1000.ogg`] }] as never)
    const a = audio()
    expect((await handleLiveRequest(speech(7), deps({}, a))).messages).toEqual([])
    expect(a.transcribe).not.toHaveBeenCalled()
    expect(chunks.create).not.toHaveBeenCalled()
  })

  it('assigns the chunk number itself and loses a concurrent race quietly', async () => {
    chunks.findMany.mockResolvedValueOnce([{ seq: 4, audioMs: 1000, segmentKeys: ['k'] }] as never)
    chunks.create.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }))
    const a = audio()
    expect((await handleLiveRequest(speech(99), deps({}, a))).messages).toEqual([])
    expect((chunks.create.mock.calls[0][0] as { data: { seq: number } }).data.seq).toBe(5)
    expect(a.transcribe).not.toHaveBeenCalled()
  })

  it('stops at the per-call caps (checks and minutes of speech)', async () => {
    const a = audio()
    chunks.findMany.mockResolvedValueOnce(Array.from({ length: 3 }, (_, i) => ({ seq: i + 1, audioMs: 0, segmentKeys: [] })) as never)
    expect((await handleLiveRequest(speech(), deps({ settings: { 'calls.liveMaxChunksPerCall': 3 } }, a))).messages).toEqual([])
    chunks.findMany.mockResolvedValueOnce([{ seq: 1, audioMs: 5 * 60_000 - 1000, segmentKeys: [] }] as never)
    expect((await handleLiveRequest(speech(), deps({ settings: { 'calls.liveMaxAudioMinutesPerCall': 5 } }, a))).messages).toEqual([]) // 3 s burst, 1 s left
    expect(a.transcribe).not.toHaveBeenCalled()
  })

  it('ignores keys outside the session (and of another speaker)', async () => {
    const a = audio()
    await handleLiveRequest(speech(1, 'calls/other-1700000000000/live/111111/1000.ogg'), deps({}, a))
    await handleLiveRequest(speech(2, `calls/${SID}/live/222222/1000.ogg`), deps({}, a))
    await handleLiveRequest(speech(3, `calls/${SID}/live/111111/999.ogg`), deps({}, a)) // start does not match the key
    expect(a.download).not.toHaveBeenCalled()
  })

  it('does nothing with speech when only typed items are on', async () => {
    const a = audio()
    const out = await handleLiveRequest(speech(), deps({ settings: { 'calls.liveActionItemsEnabled': false } }, a))
    expect(out.reason).toBe('off')
    expect(a.transcribe).not.toHaveBeenCalled()
  })

  it('a detector failure posts nothing', async () => {
    const a = audio(vi.fn(async (): Promise<DetectedItem[]> => { throw new Error('model down') }))
    expect((await handleLiveRequest(speech(), deps({}, a))).messages).toEqual([])
  })

  it('a blocked term in the owner drops the item', async () => {
    const a = audio(vi.fn(async (): Promise<DetectedItem[]> => [{ text: 'Send the deck', owner: 'Secretword', speaker: null }]))
    expect((await handleLiveRequest(speech(), deps({ filter: { ...EMPTY_POST_FILTER, blockedTerms: ['secretword'] } }, a))).messages).toEqual([])
  })

  it('reads earlier chunks of the call as context only', async () => {
    chunks.findMany
      .mockResolvedValueOnce([{ seq: 1, audioMs: 400, segmentKeys: [`calls/${SID}/live/222222/500.ogg`] }] as never)
      .mockResolvedValueOnce([{ segments: [{ discordId: '222222', name: 'Bob', startMs: 500, endMs: 900, text: 'Can someone send the deck?' }] }] as never)
    const a = audio()
    await handleLiveRequest(speech(2), deps({}, a))
    const input = (a.detect.mock.calls[0] as unknown[])[0] as { transcript: string }
    expect(input.transcript.split('\n')).toHaveLength(2)
    expect(input.transcript).toContain('Can someone send the deck?')
  })
})

describe('pruneLiveChunks', () => {
  it('deletes a session\'s chunks, or old ones, and never throws', async () => {
    chunks.deleteMany.mockResolvedValue({ count: 3 } as never)
    expect(await pruneLiveChunks({ sessionId: SID })).toBe(3)
    expect(chunks.deleteMany).toHaveBeenCalledWith({ where: { sessionId: SID } })
    chunks.deleteMany.mockRejectedValueOnce(new Error('db down'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await pruneLiveChunks({ now: 1_000_000_000_000 })).toBe(0)
  })
})

describe('sweepLiveData', () => {
  it('drops old and already-ingested chunks, expired items and items of rejected calls', async () => {
    const rec = vi.mocked(prisma.callRecording)
    chunks.deleteMany.mockResolvedValue({ count: 1 } as never)
    items.deleteMany.mockResolvedValue({ count: 2 } as never)
    chunks.findMany.mockResolvedValueOnce([{ sessionId: 'a-1700000000000' }, { sessionId: 'b-1700000000000' }] as never)
    items.findMany.mockResolvedValueOnce([{ sessionId: 'c-1700000000000' }] as never)
    rec.findMany.mockResolvedValueOnce([{ sessionId: 'a-1700000000000' }] as never).mockResolvedValueOnce([{ sessionId: 'c-1700000000000' }] as never)
    const now = 1_800_000_000_000
    expect(await sweepLiveData({ now, retentionDays: 30 })).toEqual({ chunks: 2, items: 4 })
    expect(chunks.deleteMany).toHaveBeenCalledWith({ where: { sessionId: { in: ['a-1700000000000'] } } })
    expect(items.deleteMany).toHaveBeenCalledWith({ where: { createdAt: { lt: new Date(now - 30 * 86_400_000) } } })
    expect(rec.findMany.mock.calls[1][0]).toMatchObject({ where: { status: 'REJECTED' } })
    expect(items.deleteMany).toHaveBeenCalledWith({ where: { sessionId: { in: ['c-1700000000000'] } } })
  })
  it('never throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    chunks.deleteMany.mockRejectedValue(new Error('db down'))
    chunks.findMany.mockRejectedValueOnce(new Error('db down'))
    await expect(sweepLiveData({ retentionDays: 30 })).resolves.toBeDefined()
  })
})
