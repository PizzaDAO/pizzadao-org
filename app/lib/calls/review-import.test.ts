// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/db')
vi.mock('@/app/lib/crew-mappings', () => ({ getCrewMappings: vi.fn(async () => ({ cached: true, crews: [] })) }))
vi.mock('@/app/lib/calls/access', () => ({ requireCallReviewer: vi.fn(async () => ({ ok: true, session: { discordId: '9' } })) }))
vi.mock('./recordings', () => ({ publishRecording: vi.fn(), rejectRecording: vi.fn() }))
vi.mock('./recap', () => ({ postCallRecap: vi.fn() }))
vi.mock('@/app/lib/sheets/members-list', () => ({
  fetchAllMembers: vi.fn(async () => [
    { id: '1', name: 'Ann Member', discordId: '111111111111111111' },
    { id: '2', name: 'Bo Member', discordId: '222222222222222222' },
  ]),
}))
const maxState = vi.hoisted(() => ({ value: 50, fail: false }))
vi.mock('@/app/lib/settings', () => ({
  getSetting: vi.fn(async () => {
    if (maxState.fail) throw new Error('down')
    return maxState.value
  }),
  loadSettings: vi.fn(),
}))

import { prisma } from '@/app/lib/db'
import { publishRecording, rejectRecording } from './recordings'
import { postCallRecap } from './recap'
import { bulkActionMax, bulkReview } from './bulk'
import { setSpeakerLabel } from './speakers'
import { buildSpeakerNames } from './summarize'
import { displaySpeakerName, importedSpeakerNumber, tidyLabel } from './speaker-labels'
import { POST as bulkPOST } from '@/app/api/admin/calls/bulk/route'
import { POST as speakersPOST } from '@/app/api/admin/calls/[id]/speakers/route'
import { GET as membersGET } from '@/app/api/admin/calls/members/route'

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>> & { $transaction: ReturnType<typeof vi.fn> }
const ids = (n: number) => Array.from({ length: n }, (_, i) => `rec${String(i).padStart(6, '0')}`)

beforeEach(() => {
  vi.clearAllMocks()
  maxState.value = 50
  maxState.fail = false
  db.$transaction = vi.fn(async (ops: unknown[]) => ops)
})

describe('speaker names', () => {
  const text = { speakerN: (n: number) => `Speaker ${n}`, fallback: 'Unknown speaker' }
  it('shows a label, else Speaker N for imported speakers, else the fallback', () => {
    expect(displaySpeakerName('xs:2', 'Ann', text)).toBe('Ann')
    expect(displaySpeakerName('xs:2', null, text)).toBe('Speaker 2')
    expect(displaySpeakerName('xs:2', '  ', text)).toBe('Speaker 2')
    expect(displaySpeakerName('xs:0', null, text)).toBe('Unknown speaker')
    expect(displaySpeakerName('123456789012345678', null, text)).toBe('Unknown speaker')
    expect(importedSpeakerNumber('xs:12')).toBe(12)
    expect(importedSpeakerNumber('xs:x')).toBeNull()
  })
  it('tidies labels to one short line', () => {
    expect(tidyLabel('  Ann\n\tLee  ')).toBe('Ann Lee')
    expect(tidyLabel('x'.repeat(100))).toHaveLength(40)
    expect(tidyLabel(5)).toBe('')
  })
})

describe('summary speaker names', () => {
  const line = (discordId: string, startMs: number) => ({ discordId, startMs, endMs: startMs + 1, text: 'x' })
  it('xs:N is Speaker N whatever the order of appearance, xs:0 is unknown, labels win, only Discord ids are counted', () => {
    const names = buildSpeakerNames(
      [{ discordId: 'xs:3', displayName: 'Ann' }],
      [line('xs:2', 0), line('xs:3', 10), line('xs:1', 20), line('xs:0', 30), line('123456789012345678', 40), line('223456789012345678', 50)],
    )
    expect(names).toEqual({ 'xs:2': 'Speaker 2', 'xs:3': 'Ann', 'xs:1': 'Speaker 1', 'xs:0': 'Unknown speaker', '123456789012345678': 'Speaker 1', '223456789012345678': 'Speaker 2' })
  })
  it('matches what the page shows for the same speakers', () => {
    const text = { speakerN: (n: number) => `Speaker ${n}`, fallback: 'Unknown speaker' }
    const names = buildSpeakerNames([], [line('xs:2', 0), line('xs:1', 5)])
    expect(names['xs:2']).toBe(displaySpeakerName('xs:2', null, text))
    expect(names['xs:1']).toBe(displaySpeakerName('xs:1', null, text))
  })
})

describe('setSpeakerLabel', () => {
  const rec = (over: Record<string, unknown> = {}) => ({ id: 'r1', status: 'IN_REVIEW', source: 'X_BROADCAST', speakers: [{ id: 7 }], ...over })

  it('labels a speaker, stamps the label time and keeps the transcript untouched', async () => {
    db.callRecording.findUnique.mockResolvedValue(rec())
    const now = new Date('2026-11-04T00:00:00Z')
    expect(await setSpeakerLabel('r1', 'xs:2', { displayName: ' Ann ' }, now)).toBe('ok')
    expect(db.callSpeaker.updateMany).toHaveBeenCalledWith({ where: { recordingId: 'r1', discordId: 'xs:2' }, data: { displayName: 'Ann', linkedDiscordId: null } })
    expect(db.callRecording.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { speakerLabelsUpdatedAt: now } })
  })
  it('a member link fills the name; an empty label resets to Speaker N', async () => {
    db.callRecording.findUnique.mockResolvedValue(rec())
    await setSpeakerLabel('r1', 'xs:2', { linkedDiscordId: '111111111111111111', memberName: 'Ann Member' })
    expect(db.callSpeaker.updateMany.mock.calls[0][0].data).toEqual({ displayName: 'Ann Member', linkedDiscordId: '111111111111111111' })
    await setSpeakerLabel('r1', 'xs:2', {})
    expect(db.callSpeaker.updateMany.mock.calls[1][0].data).toEqual({ displayName: null, linkedDiscordId: null })
  })
  it('sends a published call back to review', async () => {
    db.callRecording.findUnique.mockResolvedValue(rec({ status: 'PUBLISHED' }))
    await setSpeakerLabel('r1', 'xs:2', { displayName: 'Ann' })
    expect(db.callRecording.update.mock.calls[0][0].data).toMatchObject({ status: 'IN_REVIEW', publishedAt: null })
  })
  it('refuses Discord speakers, Discord calls, rejected calls and unknown speakers', async () => {
    expect(await setSpeakerLabel('r1', '123456789012345678', { displayName: 'x' })).toBe('invalid')
    expect(await setSpeakerLabel('r1', 'xs:0', { displayName: 'x' })).toBe('invalid')
    db.callRecording.findUnique.mockResolvedValue(rec({ source: 'DISCORD' }))
    expect(await setSpeakerLabel('r1', 'xs:2', { displayName: 'x' })).toBe('not-supported')
    db.callRecording.findUnique.mockResolvedValue(rec({ status: 'REJECTED' }))
    expect(await setSpeakerLabel('r1', 'xs:2', { displayName: 'x' })).toBe('not-found')
    db.callRecording.findUnique.mockResolvedValue(rec({ speakers: [] }))
    expect(await setSpeakerLabel('r1', 'xs:2', { displayName: 'x' })).toBe('not-found')
    expect(db.$transaction).not.toHaveBeenCalled()
  })
})

describe('bulkReview', () => {
  it('sends every imported id through the single-call publish gate and reports each result', async () => {
    db.callRecording.findMany.mockResolvedValue([
      { id: 'a', source: 'X_BROADCAST', status: 'IN_REVIEW' },
      { id: 'b', source: 'X_BROADCAST', status: 'IN_REVIEW' },
      { id: 'c', source: 'DISCORD', status: 'IN_REVIEW' },
    ])
    vi.mocked(publishRecording).mockResolvedValueOnce('ok').mockResolvedValueOnce('incomplete')
    const out = await bulkReview('publish', ['a', 'b', 'c', 'zz', 'a'], '9')
    expect(out).toEqual([
      { id: 'a', result: 'ok' },
      { id: 'b', result: 'incomplete' },
      { id: 'c', result: 'not-imported' },
      { id: 'zz', result: 'not-found' },
    ])
    expect(publishRecording).toHaveBeenCalledTimes(2)
    expect(postCallRecap).not.toHaveBeenCalled()
  })
  it('rejects imported calls only', async () => {
    db.callRecording.findMany.mockResolvedValue([{ id: 'a', source: 'X_BROADCAST', status: 'IN_REVIEW' }, { id: 'c', source: 'DISCORD', status: 'IN_REVIEW' }])
    vi.mocked(rejectRecording).mockResolvedValue(true)
    const out = await bulkReview('reject', ['a', 'c'], '9')
    expect(out).toEqual([{ id: 'a', result: 'rejected' }, { id: 'c', result: 'not-imported' }])
    expect(rejectRecording).toHaveBeenCalledTimes(1)
  })
  it('only calls in review are touched, for publish and for reject', async () => {
    db.callRecording.findMany.mockResolvedValue([
      { id: 'p', source: 'X_BROADCAST', status: 'PUBLISHED' },
      { id: 'r', source: 'X_BROADCAST', status: 'REJECTED' },
      { id: 'w', source: 'X_BROADCAST', status: 'PROCESSING' },
    ])
    for (const action of ['publish', 'reject'] as const) {
      expect(await bulkReview(action, ['p', 'r', 'w'], '9')).toEqual([
        { id: 'p', result: 'not-allowed' },
        { id: 'r', result: 'not-allowed' },
        { id: 'w', result: 'not-allowed' },
      ])
    }
    expect(publishRecording).not.toHaveBeenCalled()
    expect(rejectRecording).not.toHaveBeenCalled()
  })
  it('the cap follows the setting, never exceeds 50, and is 1 when settings fail', async () => {
    maxState.value = 20
    expect(await bulkActionMax()).toBe(20)
    maxState.value = 500
    expect(await bulkActionMax()).toBe(50)
    maxState.fail = true
    expect(await bulkActionMax()).toBe(1)
  })
})

describe('bulk route', () => {
  const call = (body: unknown) => bulkPOST(new Request('http://x/api', { method: 'POST', body: JSON.stringify(body) }))

  it('rejects a bad action, no confirmation, junk ids and more than the cap', async () => {
    expect((await call({ action: 'delete', ids: ids(1), confirm: true })).status).toBe(400)
    expect((await call({ action: 'publish', ids: ids(1) })).status).toBe(400)
    expect((await call({ action: 'publish', ids: [] , confirm: true})).status).toBe(400)
    expect((await call({ action: 'publish', ids: ['x'], confirm: true })).status).toBe(400)
    expect((await call({ action: 'publish', ids: ids(51), confirm: true })).status).toBe(400)
    maxState.value = 5
    expect((await call({ action: 'publish', ids: ids(6), confirm: true })).status).toBe(400)
    expect(db.callRecording.findMany).not.toHaveBeenCalled()
  })
  it('publishes up to the cap and returns counts', async () => {
    db.callRecording.findMany.mockResolvedValue(ids(50).map((id) => ({ id, source: 'X_BROADCAST', status: 'IN_REVIEW' })))
    vi.mocked(publishRecording).mockResolvedValue('ok')
    const res = await call({ action: 'publish', ids: ids(50), confirm: true })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.counts).toEqual({ ok: 50 })
    expect(publishRecording).toHaveBeenCalledTimes(50)
    expect(postCallRecap).not.toHaveBeenCalled()
  })
})

describe('speakers route', () => {
  const call = (body: unknown) => speakersPOST(new Request('http://x/api', { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ id: 'r1' }) })
  const rec = { id: 'r1', status: 'IN_REVIEW', source: 'X_BROADCAST', speakers: [{ id: 1 }] }

  it('validates the speaker id and only links real members', async () => {
    expect((await call({ speakerId: '123456789012345678' })).status).toBe(400)
    expect((await call({ speakerId: 'xs:2', linkedDiscordId: 'abc' })).status).toBe(400)
    expect((await call({ speakerId: 'xs:2', linkedDiscordId: '999999999999999999' })).status).toBe(400)
    expect(db.callRecording.findUnique).not.toHaveBeenCalled()
  })
  it('links a member and takes the name from the member list', async () => {
    db.callRecording.findUnique.mockResolvedValue(rec)
    const res = await call({ speakerId: 'xs:2', linkedDiscordId: '111111111111111111' })
    expect(res.status).toBe(200)
    expect(db.callSpeaker.updateMany.mock.calls[0][0].data).toEqual({ displayName: 'Ann Member', linkedDiscordId: '111111111111111111' })
  })
  it('answers 409 for a Discord-recorded call', async () => {
    db.callRecording.findUnique.mockResolvedValue({ ...rec, source: 'DISCORD' })
    expect((await call({ speakerId: 'xs:2', displayName: 'x' })).status).toBe(409)
  })
})

describe('members route', () => {
  it('needs two characters and returns at most a few matches', async () => {
    expect(await (await membersGET(new Request('http://x/api?q=a'))).json()).toEqual({ members: [] })
    const body = await (await membersGET(new Request('http://x/api?q=member'))).json()
    expect(body.members).toEqual([
      { discordId: '111111111111111111', name: 'Ann Member' },
      { discordId: '222222222222222222', name: 'Bo Member' },
    ])
  })
})
