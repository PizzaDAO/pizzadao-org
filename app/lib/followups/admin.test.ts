import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/app/lib/db')
vi.mock('@/app/lib/sheets/members-list', () => ({
  fetchAllMembers: vi.fn(async () => [{ id: 'm1', name: 'Alpha Bravo', discordId: '111' }]),
}))
vi.mock('./extract', async (orig) => ({ ...(await orig<typeof import('./extract')>()), extractFollowUps: vi.fn() }))

import { prisma } from '@/app/lib/db'
import { approveFollowUp, dismissFollowUp, editFollowUp, FollowUpError } from './admin'
import { draftFollowUpsForRecording, storeDrafts } from './draft'
import type { FollowUpDraft } from './extract'

const V = '2026-11-02T10:00:00.000Z'
const row = (over: Record<string, unknown> = {}) => ({
  id: 'f1', status: 'DRAFT', updatedAt: new Date('2026-11-02T10:00:00Z'), ownerDiscordId: '111', ownerMemberId: 'm1', message: 'Hi', channel: null, dueAt: null, ...over,
})

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(prisma.followUp.updateMany).mockResolvedValue({ count: 1 } as never)
  vi.mocked(prisma.followUpEvent.create).mockResolvedValue({} as never)
})

describe('admin queue reach', () => {
  const setup = (reach: Array<{ telegramId: string; state: string; failures: number; recheckAt: Date | null }>) => {
    vi.mocked(prisma.followUp.findMany).mockResolvedValue([{ ...row(), recordingId: null, events: [] }] as never)
    vi.mocked(prisma.telegramAccount.findMany).mockResolvedValue([{ discordId: '111', telegramId: '901' }] as never)
    vi.mocked(prisma.telegramReach.findMany).mockResolvedValue(reach as never)
    vi.mocked(prisma.messagingOptOut.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.callRecording.findMany).mockResolvedValue([] as never)
  }
  it('shows Discord only while Telegram sending is off (preview or switch off), even for a reachable person', async () => {
    const { listFollowUps } = await import('./admin')
    setup([{ telegramId: '901', state: 'OK', failures: 0, recheckAt: null }])
    const r = await listFollowUps()
    expect(r.items[0]).toMatchObject({ telegramLinked: true, telegramDmAllowed: false, telegramState: 'OK' })
    expect(r.reach).toEqual({ people: 1, linked: 1, telegram: 1 })
  })
  it('counts only confirmed-reachable people as reachable', async () => {
    const { listFollowUps } = await import('./admin')
    setup([{ telegramId: '901', state: 'NOT_STARTED', failures: 1, recheckAt: new Date('2099-01-01') }])
    expect((await listFollowUps()).reach).toEqual({ people: 1, linked: 1, telegram: 0 })
  })
})

describe('approval is the only door to sending', () => {
  it('approves a draft with an owner and logs the event', async () => {
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue(row() as never)
    await approveFollowUp('f1', 'admin1', { expectedUpdatedAt: V })
    expect(prisma.followUp.updateMany).toHaveBeenCalledWith({
      where: { id: 'f1', status: { in: ['DRAFT'] }, updatedAt: new Date(V) },
      data: expect.objectContaining({ status: 'APPROVED', approvedBy: 'admin1', escalateOnly: false }),
    })
    expect(prisma.followUpEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: 'approved', actorId: 'admin1' }) })
    // The write is conditional on the row not having changed since it was read.
    expect(vi.mocked(prisma.followUp.updateMany).mock.calls[0][0]).toMatchObject({ where: { updatedAt: new Date(V) } })
  })
  it('refuses an unresolved row unless it goes to the approvers', async () => {
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue(row({ ownerDiscordId: null }) as never)
    await expect(approveFollowUp('f1', 'admin1', { expectedUpdatedAt: V })).rejects.toBeInstanceOf(FollowUpError)
    expect(prisma.followUp.updateMany).not.toHaveBeenCalled()
    await approveFollowUp('f1', 'admin1', { escalateOnly: true, expectedUpdatedAt: V })
    expect(prisma.followUp.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ escalateOnly: true }) }))
  })
  it('cannot approve something already sent, dismissed or approved', async () => {
    for (const status of ['SENT', 'DISMISSED', 'APPROVED', 'DONE']) {
      vi.mocked(prisma.followUp.findUnique).mockResolvedValue(row({ status }) as never)
      await expect(approveFollowUp('f1', 'admin1', { expectedUpdatedAt: V })).rejects.toMatchObject({ status: 409 })
    }
    expect(prisma.followUp.updateMany).not.toHaveBeenCalled()
  })
  it('a lost race is a conflict, not a double approval', async () => {
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue(row() as never)
    vi.mocked(prisma.followUp.updateMany).mockResolvedValue({ count: 0 } as never)
    await expect(approveFollowUp('f1', 'admin1', { expectedUpdatedAt: V })).rejects.toMatchObject({ status: 409 })
    expect(prisma.followUpEvent.create).not.toHaveBeenCalled()
  })
  it('rejects an approval made against a stale view of the row', async () => {
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue(row() as never)
    await expect(approveFollowUp('f1', 'admin1', { expectedUpdatedAt: '2026-11-02T09:00:00.000Z' })).rejects.toMatchObject({ status: 409 })
    expect(prisma.followUp.updateMany).not.toHaveBeenCalled()
  })
  it('re-approval clears the delivery-attempt marker', async () => {
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue(row({ status: 'FAILED' }) as never)
    await approveFollowUp('f1', 'admin1', { expectedUpdatedAt: V })
    expect(prisma.followUp.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ sendAttemptAt: null }) }))
  })
  it('dismissing a finished (DONE) row is a 409, not a crash', async () => {
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue(row({ status: 'DONE' }) as never)
    await expect(dismissFollowUp('f1', 'admin1')).rejects.toMatchObject({ status: 409 })
  })
  it('refuses to dismiss an APPROVED row while a send is in flight', async () => {
    const soon = new Date(Date.now() + 120_000)
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue(row({ status: 'APPROVED', sendAttemptAt: new Date(), sendAfter: soon }) as never)
    await expect(dismissFollowUp('f1', 'admin1')).rejects.toMatchObject({ status: 409 })
    // A merely scheduled row (no attempt marker) can still be dismissed.
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue(row({ status: 'APPROVED', sendAttemptAt: null, sendAfter: soon }) as never)
    await dismissFollowUp('f1', 'admin1')
  })
  it('dismiss is logged', async () => {
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue(row() as never)
    await dismissFollowUp('f1', 'admin1')
    expect(prisma.followUpEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: 'dismissed' }) })
  })
})

describe('editing', () => {
  it('logs a diff and only touches editable rows', async () => {
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue(row() as never)
    await editFollowUp('f1', 'admin1', { message: 'Hi there' })
    const ev = vi.mocked(prisma.followUpEvent.create).mock.calls[0][0] as unknown as { data: { type: string; data: { diff: string } } }
    expect(ev.data.type).toBe('edited')
    expect(ev.data.data.diff).toContain('Hi there')
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue(row({ status: 'SENT' }) as never)
    await expect(editFollowUp('f1', 'admin1', { message: 'x' })).rejects.toMatchObject({ status: 409 })
  })
  it('rejects an empty or oversized message', async () => {
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue(row() as never)
    await expect(editFollowUp('f1', 'a', { message: '   ' })).rejects.toMatchObject({ status: 400 })
    await expect(editFollowUp('f1', 'a', { message: 'x'.repeat(1501) })).rejects.toMatchObject({ status: 400 })
  })
  it('takes the Discord id from the member sheet, never from the client', async () => {
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue(row({ ownerDiscordId: null, ownerMemberId: null }) as never)
    await editFollowUp('f1', 'a', { ownerMemberId: 'm1' })
    expect(prisma.followUp.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ownerDiscordId: '111', ownerMemberId: 'm1' }) }))
    await expect(editFollowUp('f1', 'a', { ownerMemberId: 'nope' })).rejects.toMatchObject({ status: 400 })
  })
})

describe('drafting is idempotent', () => {
  const d = (over: Partial<FollowUpDraft> = {}): FollowUpDraft => ({
    sourceKey: 'rec1:1000:member-a', ownerName: 'Alpha Bravo', speakerDiscordId: null, kind: 'ask_status', ask: 'ask', message: 'hi', dueText: null, dueAt: null, quote: 'q', startMs: 1000, ...over,
  })
  it('creates only drafts whose sourceKey is new, each with a drafted event', async () => {
    vi.mocked(prisma.followUp.findMany).mockResolvedValue([{ sourceKey: 'rec1:1000:member-a' }] as never)
    vi.mocked(prisma.followUp.create).mockResolvedValue({} as never)
    const members = [{ id: 'm1', name: 'Alpha Bravo', discordId: '111' }]
    const n = await storeDrafts('rec1', [d(), d({ sourceKey: 'rec1:2000:member-a', startMs: 2000 })], members, 'system')
    expect(n).toBe(1)
    expect(prisma.followUp.create).toHaveBeenCalledTimes(1)
    const arg = vi.mocked(prisma.followUp.create).mock.calls[0][0] as unknown as { data: { status?: string; ownerDiscordId: string; events: { create: Array<{ type: string }> } } }
    expect(arg.data.status).toBeUndefined() // schema default DRAFT: never created approved
    expect(arg.data.ownerDiscordId).toBe('111')
    expect(arg.data.events.create[0].type).toBe('drafted')
  })
  it('a parallel run that wins the unique key is not an error', async () => {
    vi.mocked(prisma.followUp.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.followUp.create).mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }))
    expect(await storeDrafts('rec1', [d()], [], 'system')).toBe(0)
  })
  it('skips rejected or unsummarized calls and calls already drafted', async () => {
    const rec = { id: 'rec1', status: 'REJECTED', summary: 'x', crewId: null, actionItems: [], transcript: [], redactedSpeakerIds: [], redactedSegmentIds: [], followupsDraftedAt: null, followupsAttempts: 0, speakers: [] }
    vi.mocked(prisma.callRecording.findUnique).mockResolvedValue(rec as never)
    expect((await draftFollowUpsForRecording('rec1')).result).toBe('not-ready')
    vi.mocked(prisma.callRecording.findUnique).mockResolvedValue({ ...rec, status: 'IN_REVIEW', summary: null } as never)
    expect((await draftFollowUpsForRecording('rec1')).result).toBe('not-ready')
    vi.mocked(prisma.callRecording.findUnique).mockResolvedValue({ ...rec, status: 'IN_REVIEW', followupsDraftedAt: new Date() } as never)
    expect((await draftFollowUpsForRecording('rec1')).result).toBe('already')
    expect(prisma.followUp.create).not.toHaveBeenCalled()
  })
})
