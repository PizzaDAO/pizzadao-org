// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/lib/db')
vi.mock('ai', () => ({ generateText: vi.fn(), Output: { object: vi.fn((o) => o) } }))
vi.mock('@ai-sdk/openai', () => ({ createOpenAI: vi.fn() }))
vi.mock('@/app/lib/discord', () => ({ getMembersWithRoles: vi.fn(async () => []) }))
vi.mock('@/app/lib/sheets/members-list', () => ({ fetchAllMembers: vi.fn(async () => []) }))
vi.mock('@/app/lib/calls/recap-refresh', () => ({ requestRecapRefresh: vi.fn(async () => true) }))
vi.mock('@/app/lib/calls/action-keys', async (orig) => ({ ...(await orig<typeof import('@/app/lib/calls/action-keys')>()), ensureActionKeys: vi.fn(async () => [{ key: 'kkkkkkkk', text: 'Ship it' }]) }))
vi.mock('@/app/lib/calls/post-filters', async (orig) => ({
  ...(await orig<typeof import('@/app/lib/calls/post-filters')>()),
  loadPostFilter: vi.fn(async () => ({ excludedCrewIds: [], excludedCrewLabelTerms: [], blockedTerms: ['secretproject'] })),
}))

import { prisma } from '@/app/lib/db'
import { requestRecapRefresh } from '@/app/lib/calls/recap-refresh'
import { applyMemberAction, setDoneUrl } from './actions'
import { dismissFollowUp, FollowUpError, linkFollowUp } from './admin'
import { storeDrafts } from './draft'
import { buildExtractionPrompt, parseExtraction, type FollowUpDraft } from './extract'

const ID = 'c'.repeat(25)
const row = (over: Record<string, unknown> = {}) => ({ id: ID, ask: 'Send the report', status: 'SENT', ownerDiscordId: '111', ownerName: 'Member A', recordingId: 'rec1', actionKey: 'kkkkkkkk', doneUrl: null, lastReply: null, lastReplyAt: null, ...over })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requestRecapRefresh).mockResolvedValue(true)
  vi.mocked(prisma.followUpEvent.create).mockResolvedValue({} as never)
  vi.mocked(prisma.followUpEvent.count).mockResolvedValue(0 as never)
  vi.stubEnv('CALL_RECAP_LIVE_STATUS_ENABLED', '1')
  vi.mocked(prisma.followUp.updateMany).mockResolvedValue({ count: 1 } as never)
  vi.mocked(prisma.followUp.update).mockResolvedValue({} as never)
  vi.mocked(prisma.appSetting.findMany).mockResolvedValue([])
  vi.mocked(prisma.$transaction).mockImplementation((async (fn: (tx: unknown) => unknown) => fn({ $executeRaw: vi.fn(), followUpEvent: { count: vi.fn(async () => 0), create: vi.fn() } })) as never)
})
afterEach(() => vi.unstubAllEnvs())

describe('extraction labels each action item A1..An and links the draft to its key', () => {
  const item = (over: Record<string, unknown> = {}) => ({
    ownerName: 'Member A', ownerSpeaker: null, kind: 'ask_status', ask: 'ask', draftMessage: 'hi', dueText: null, dueDate: null, quote: 'q', startMs: 1000, actionItem: null, ...over,
  })
  const byAction = new Map([['A1', 'aaaaaaaa'], ['A2', 'bbbbbbbb']])
  const now = new Date('2026-11-02T10:00:00Z')

  it('the prompt lists the items as A1.. and returns the label to key map', () => {
    const { prompt, byAction: map } = buildExtractionPrompt({
      segments: [{ discordId: '100', startMs: 0, endMs: 1000, text: 'hello there everyone' }] as never,
      speakers: [{ discordId: '100', displayName: 'Ann' }],
      actionItems: [{ text: 'First thing', owner: 'Ann', key: 'aaaaaaaa' }, { text: '', key: 'zzzzzzzz' }, { text: 'Second thing', key: 'bbbbbbbb' }],
      today: now,
      recordingId: 'rec1',
    })
    expect(prompt).toContain('A1. First thing (owner: Ann)')
    expect(prompt).toContain('A2. Second thing')
    expect([...map]).toEqual([['A1', 'aaaaaaaa'], ['A2', 'bbbbbbbb']])
  })

  it('a valid label maps to the key, case and spacing tolerant', () => {
    expect(parseExtraction({ items: [item({ actionItem: ' a2 ' })] }, 'rec1', new Map(), now, byAction)[0].actionKey).toBe('bbbbbbbb')
  })
  it('an unknown label, null and a missing field all draft without a link', () => {
    const out = parseExtraction({ items: [item({ actionItem: 'A9' }), item({ actionItem: null, startMs: 2 }), (({ actionItem: _a, ...rest }) => rest)(item({ startMs: 3 }))] }, 'rec1', new Map(), now, byAction)
    expect(out.map((d) => d.actionKey)).toEqual([null, null, null])
  })
  it('a malformed label does not lose the item', () => {
    const out = parseExtraction({ items: [item({ actionItem: 5 })] }, 'rec1', new Map(), now, byAction)
    expect(out).toHaveLength(1)
    expect(out[0].actionKey).toBeNull()
  })

  it('storeDrafts writes the key', async () => {
    vi.mocked(prisma.followUp.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.followUp.create).mockResolvedValue({} as never)
    const d: FollowUpDraft = { sourceKey: 'rec1:1000:a', ownerName: 'Member A', speakerDiscordId: null, kind: 'ask_status', ask: 'a', message: 'm', dueText: null, dueAt: null, quote: 'q', startMs: 1000, actionKey: 'aaaaaaaa' }
    await storeDrafts('rec1', [d, { ...d, sourceKey: 'rec1:2000:a', actionKey: null }], [], 'system')
    const data = vi.mocked(prisma.followUp.create).mock.calls.map((c) => (c[0] as unknown as { data: { actionKey: string | null } }).data.actionKey)
    expect(data).toEqual(['aaaaaaaa', null])
  })
})

describe('applyMemberAction asks the recap to refresh', () => {
  it('after a move into in progress / needs help / done on a linked follow-up', async () => {
    for (const [action, from] of [['wip', 'SENT'], ['help', 'SENT'], ['done', 'IN_PROGRESS']] as const) {
      vi.mocked(prisma.followUp.findUnique).mockResolvedValue(row({ status: from }) as never)
      vi.mocked(requestRecapRefresh).mockClear()
      expect(await applyMemberAction({ followUpId: ID, discordId: '111', actorId: '111', action })).toMatchObject({ ok: true, kind: 'status' })
      expect(requestRecapRefresh).toHaveBeenCalledWith('rec1', 'follow-up-status')
    }
  })
  it('not for an unlinked follow-up, a repeated tap, a reply or a snooze', async () => {
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue(row({ actionKey: null }) as never)
    await applyMemberAction({ followUpId: ID, discordId: '111', actorId: '111', action: 'done' })
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue(row({ status: 'IN_PROGRESS' }) as never)
    await applyMemberAction({ followUpId: ID, discordId: '111', actorId: '111', action: 'wip' })
    await applyMemberAction({ followUpId: ID, discordId: '111', actorId: '111', action: 'reply', text: 'hi' })
    expect(requestRecapRefresh).not.toHaveBeenCalled()
  })
  it('a failed move does not ask', async () => {
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue(row() as never)
    vi.mocked(prisma.followUp.updateMany).mockResolvedValue({ count: 0 } as never)
    expect(await applyMemberAction({ followUpId: ID, discordId: '111', actorId: '111', action: 'done' })).toEqual({ ok: false, reason: 'closed' })
    expect(requestRecapRefresh).not.toHaveBeenCalled()
  })
})

describe('setDoneUrl', () => {
  const set = (url: unknown, over: Record<string, unknown> = {}, who = '111') => {
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue(row({ status: 'DONE', ...over }) as never)
    return setDoneUrl({ followUpId: ID, discordId: who, actorId: who, url })
  }

  it('stores a valid link, logs it, asks for a refresh and alerts the approvers with the host only', async () => {
    const r = await set('https://www.example.org/docs/plan?x=1')
    expect(r).toMatchObject({ ok: true, kind: 'link', status: 'DONE' })
    expect((r as { notify?: string }).notify).toBe('Member A added a link for "Send the report": example.org')
    expect(prisma.$transaction).not.toHaveBeenCalled() // not the shared daily help-alert cap
    expect(prisma.followUp.updateMany).toHaveBeenCalledWith({ where: { id: ID, status: 'DONE' }, data: { doneUrl: 'https://www.example.org/docs/plan?x=1', doneUrlAt: expect.any(Date), doneUrlBy: '111' } })
    expect(prisma.followUpEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: 'done-link', data: { host: 'example.org' } }) })
    expect(requestRecapRefresh).toHaveBeenCalledWith('rec1', 'done-link')
  })

  it('only the owner, only once DONE', async () => {
    expect(await set('https://example.org/x', {}, '999')).toEqual({ ok: false, reason: 'not-yours' })
    expect(await set('https://example.org/x', { status: 'SENT' })).toEqual({ ok: false, reason: 'closed' })
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue(null)
    expect(await setDoneUrl({ followUpId: ID, discordId: '111', actorId: '111', url: 'https://example.org/x' })).toEqual({ ok: false, reason: 'not-found' })
    expect(prisma.followUp.updateMany).not.toHaveBeenCalled()
  })

  it('refuses javascript:, data:, spaces, angle brackets, too long, no scheme, and a blocked term', async () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'https://example.org/a b', 'https://example.org/<x>', 'https://example.org/(x)', `https://example.org/${'a'.repeat(500)}`, 'example.org/doc', 'ftp://example.org/x', '', null, 5, 'https://example.org/secretproject/plan']) {
      expect(await set(bad), String(bad)).toEqual({ ok: false, reason: 'bad-url' })
    }
    expect(prisma.followUp.updateMany).not.toHaveBeenCalled()
    expect(requestRecapRefresh).not.toHaveBeenCalled()
  })

  it('not offered (closed, nothing stored) when the follow-up is not tied to an item, or either switch is off', async () => {
    expect(await set('https://example.org/x', { actionKey: null })).toEqual({ ok: false, reason: 'closed' })
    vi.stubEnv('CALL_RECAP_LIVE_STATUS_ENABLED', '')
    expect(await set('https://example.org/x')).toEqual({ ok: false, reason: 'closed' })
    vi.stubEnv('CALL_RECAP_LIVE_STATUS_ENABLED', '1')
    vi.stubEnv('CALL_RECAP_MEMBER_LINKS_ENABLED', '0')
    expect(await set('https://example.org/x')).toEqual({ ok: false, reason: 'closed' })
    expect(prisma.followUp.updateMany).not.toHaveBeenCalled()
    expect(requestRecapRefresh).not.toHaveBeenCalled()
  })

  it('every change alerts the approvers, however many alerts the member already caused; the same link again is quiet', async () => {
    const r = await set('https://example.org/second', { doneUrl: 'https://example.org/first' })
    expect((r as { notify?: string }).notify).toBe('Member A changed a link for "Send the report": example.org')
    const same = await set('https://example.org/first', { doneUrl: 'https://example.org/first' })
    expect(same).toMatchObject({ ok: true, kind: 'link' })
    expect((same as { notify?: string }).notify).toBeUndefined()
  })

  it('a link can be changed only a few times (each change is an approver alert)', async () => {
    vi.mocked(prisma.followUpEvent.count).mockResolvedValue(5 as never)
    expect(await set('https://example.org/x')).toEqual({ ok: false, reason: 'closed' })
    expect(prisma.followUp.updateMany).not.toHaveBeenCalled()
  })

  it('a valid link that is too long once normalized is a validation error, not a crash', async () => {
    const long = `https://exämple.org/${'ü'.repeat(200)}`
    expect(await set(long)).toEqual({ ok: false, reason: 'bad-url' })
  })
})

describe('linkFollowUp (reviewer)', () => {
  beforeEach(() => {
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue({ id: ID, recordingId: 'rec1', actionKey: null, doneUrl: null } as never)
  })

  it('links to a key the call has, in any status, and logs it', async () => {
    await linkFollowUp(ID, 'admin1', { actionKey: 'kkkkkkkk' })
    expect(prisma.followUp.update).toHaveBeenCalledWith({ where: { id: ID }, data: { actionKey: 'kkkkkkkk' } })
    // An item that had no key when the page was drawn is addressed by number (the keys exist by now).
    vi.mocked(prisma.followUp.update).mockClear()
    await linkFollowUp(ID, 'admin1', { actionKey: '#1' })
    expect(prisma.followUp.update).toHaveBeenCalledWith({ where: { id: ID }, data: { actionKey: 'kkkkkkkk' } })
    await expect(linkFollowUp(ID, 'admin1', { actionKey: '#9' })).rejects.toMatchObject({ status: 400 })
    expect(prisma.followUpEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: 'linked', actorId: 'admin1', data: { from: null, to: 'kkkkkkkk' } }) })
    expect(requestRecapRefresh).toHaveBeenCalledWith('rec1', 'admin-link')
  })

  it('an unknown key is a 400 and changes nothing', async () => {
    await expect(linkFollowUp(ID, 'admin1', { actionKey: 'nope1234' })).rejects.toMatchObject({ status: 400 })
    expect(prisma.followUp.update).not.toHaveBeenCalled()
  })

  it('unlinks, and the unlink also refreshes the recap', async () => {
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue({ id: ID, recordingId: 'rec1', actionKey: 'kkkkkkkk', doneUrl: null } as never)
    await linkFollowUp(ID, 'admin1', { actionKey: null })
    expect(prisma.followUp.update).toHaveBeenCalledWith({ where: { id: ID }, data: { actionKey: null } })
    expect(requestRecapRefresh).toHaveBeenCalled()
  })

  it('sets, validates and clears the finished-work link', async () => {
    await linkFollowUp(ID, 'admin1', { doneUrl: 'https://example.org/done' })
    expect(prisma.followUp.update).toHaveBeenCalledWith({ where: { id: ID }, data: { doneUrl: 'https://example.org/done', doneUrlAt: expect.any(Date), doneUrlBy: 'admin1' } })
    await expect(linkFollowUp(ID, 'admin1', { doneUrl: 'javascript:alert(1)' })).rejects.toBeInstanceOf(FollowUpError)
    await expect(linkFollowUp(ID, 'admin1', { doneUrl: 'https://example.org/secretproject' })).rejects.toMatchObject({ status: 400 })
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue({ id: ID, recordingId: 'rec1', actionKey: null, doneUrl: 'https://example.org/done' } as never)
    vi.mocked(prisma.followUp.update).mockClear()
    await linkFollowUp(ID, 'admin1', { doneUrl: null })
    expect(prisma.followUp.update).toHaveBeenCalledWith({ where: { id: ID }, data: { doneUrl: null, doneUrlAt: null, doneUrlBy: null } })
  })

  it('nothing to change means no write and no refresh; unknown row is a 404', async () => {
    await linkFollowUp(ID, 'admin1', { actionKey: null, doneUrl: null })
    expect(prisma.followUp.update).not.toHaveBeenCalled()
    expect(requestRecapRefresh).not.toHaveBeenCalled()
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue(null)
    await expect(linkFollowUp(ID, 'admin1', { actionKey: null })).rejects.toMatchObject({ status: 404 })
  })

  it('a follow-up without a call cannot be linked', async () => {
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue({ id: ID, recordingId: null, actionKey: null, doneUrl: null } as never)
    await expect(linkFollowUp(ID, 'admin1', { actionKey: 'kkkkkkkk' })).rejects.toMatchObject({ status: 400 })
  })
})

describe('dismissing an in-progress follow-up refreshes the recap', () => {
  it('only when the dismissed row counted', async () => {
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue({ status: 'IN_PROGRESS', sendAfter: null, sendAttemptAt: null, recordingId: 'rec1', actionKey: 'kkkkkkkk' } as never)
    await dismissFollowUp(ID, 'admin1')
    expect(requestRecapRefresh).toHaveBeenCalledWith('rec1', 'dismissed')
    vi.mocked(requestRecapRefresh).mockClear()
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue({ status: 'DRAFT', sendAfter: null, sendAttemptAt: null, recordingId: 'rec1', actionKey: 'kkkkkkkk' } as never)
    await dismissFollowUp(ID, 'admin1')
    expect(requestRecapRefresh).not.toHaveBeenCalled()
  })
})
