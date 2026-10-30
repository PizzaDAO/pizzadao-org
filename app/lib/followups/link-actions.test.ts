import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/app/lib/db')
vi.mock('@/app/lib/discord', () => ({ getMembersWithRoles: vi.fn(async () => []) }))

import { prisma } from '@/app/lib/db'
import { applyMemberAction } from './actions'
import { lookupLink, performLinkAction } from './link-actions'
import { signLink } from './links'

const ID = 'c'.repeat(25)
const SECRET = 'a'.repeat(32)
const row = (over: Record<string, unknown> = {}) => ({ id: ID, ask: 'Send the report', status: 'SENT', ownerDiscordId: '111', ownerName: 'Member A', lastReply: null, lastReplyAt: null, ...over })
const tok = (a: Parameters<typeof signLink>[1]) => signLink(ID, a, 30)!

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('FOLLOWUP_LINK_SECRET', SECRET)
  vi.mocked(prisma.followUpEvent.create).mockResolvedValue({} as never)
  vi.mocked(prisma.followUp.updateMany).mockResolvedValue({ count: 1 } as never)
  vi.mocked(prisma.followUp.update).mockResolvedValue({} as never)
  vi.mocked(prisma.messagingOptOut.upsert).mockResolvedValue({} as never)
  vi.mocked(prisma.appSetting.findMany).mockResolvedValue([])
})
afterEach(() => vi.unstubAllEnvs())

describe('lookupLink (the page: it only looks)', () => {
  it('shows the ask and whether the follow-up is still open, and changes nothing', async () => {
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue(row() as never)
    expect(await lookupLink(tok('done'))).toMatchObject({ ok: true, ask: 'Send the report', open: true })
    expect(prisma.followUp.update).not.toHaveBeenCalled()
    expect(prisma.followUp.updateMany).not.toHaveBeenCalled()
    expect(prisma.followUpEvent.create).not.toHaveBeenCalled()
    expect(prisma.messagingOptOut.upsert).not.toHaveBeenCalled()
  })
  it('a closed follow-up is shown as closed, but Stop always works', async () => {
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue(row({ status: 'DONE' }) as never)
    expect(await lookupLink(tok('done'))).toMatchObject({ ok: true, open: false })
    expect(await lookupLink(tok('stop'))).toMatchObject({ ok: true, open: true })
    expect(await lookupLink(tok('reply'))).toMatchObject({ ok: true, open: true })
  })
  it('bad, expired and unknown links', async () => {
    expect(await lookupLink('nope')).toEqual({ ok: false, reason: 'invalid' })
    expect(await lookupLink(tok('done'), new Date(Date.now() + 40 * 86400_000))).toEqual({ ok: false, reason: 'expired' })
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue(null)
    expect(await lookupLink(tok('done'))).toEqual({ ok: false, reason: 'not-found' })
  })
})

describe('performLinkAction (the POST)', () => {
  it('done / wip / help move the status as the owner, with the link as actor', async () => {
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue(row() as never)
    const r = await performLinkAction(tok('done'))
    expect(r).toMatchObject({ ok: true, kind: 'status', status: 'DONE' })
    expect(prisma.followUp.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'DONE' }) }))
    expect(prisma.followUpEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: 'button', actorId: 'link:done' }) })
  })
  it('snooze sets snoozedUntil from the setting and leaves the status alone', async () => {
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue(row() as never)
    vi.mocked(prisma.appSetting.findMany).mockResolvedValue([{ key: 'followups.snoozeDays', value: 5 }] as never)
    const before = Date.now()
    const r = await performLinkAction(tok('snooze'))
    expect(r).toMatchObject({ ok: true, kind: 'snoozed', status: 'SENT' })
    const data = vi.mocked(prisma.followUp.update).mock.calls[0][0].data as { snoozedUntil: Date; status?: string }
    expect(data.status).toBeUndefined()
    expect(data.snoozedUntil.getTime()).toBeGreaterThanOrEqual(before + 5 * 86400_000)
    expect(prisma.followUpEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: 'snooze' }) })
    // No approver alert for a snooze.
    expect((r as { notify?: string }).notify).toBeUndefined()
  })
  it('reply stores the text and still alerts the approvers', async () => {
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue(row() as never)
    vi.mocked(prisma.$transaction).mockImplementation((async (fn: (tx: unknown) => unknown) => fn({ $executeRaw: vi.fn(), followUpEvent: { count: vi.fn(async () => 0), create: vi.fn() } })) as never)
    const r = await performLinkAction(tok('reply'), { text: '  all good  ' })
    expect(r).toMatchObject({ ok: true, kind: 'reply', status: 'REPLIED' })
    expect((r as { notify?: string }).notify).toContain('all good')
    expect(await performLinkAction(tok('reply'), { text: '   ' })).toEqual({ ok: false, reason: 'empty' })
  })
  it('stop opts the owner out of every channel', async () => {
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue(row() as never)
    expect(await performLinkAction(tok('stop'))).toMatchObject({ ok: true, kind: 'stopped' })
    expect(prisma.messagingOptOut.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { discordId: '111' } }))
  })
  it('undo of a Stop only works for a few minutes, and only from the Stop link', async () => {
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue(row() as never)
    vi.mocked(prisma.messagingOptOut.deleteMany).mockResolvedValue({ count: 1 } as never)
    expect(await performLinkAction(tok('stop'), { undo: true })).toEqual({ ok: true, kind: 'undone' })
    const where = vi.mocked(prisma.messagingOptOut.deleteMany).mock.calls[0][0]?.where as { createdAt: { gte: Date } }
    expect(Date.now() - where.createdAt.gte.getTime()).toBeLessThanOrEqual(10 * 60_000 + 1000)
    vi.mocked(prisma.messagingOptOut.deleteMany).mockResolvedValue({ count: 0 } as never)
    expect(await performLinkAction(tok('stop'), { undo: true })).toEqual({ ok: false, reason: 'closed' })
    expect(await performLinkAction(tok('done'), { undo: true })).toEqual({ ok: false, reason: 'invalid' })
  })
  it('a closed follow-up refuses done', async () => {
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue(row({ status: 'DISMISSED' }) as never)
    expect(await performLinkAction(tok('done'))).toEqual({ ok: false, reason: 'closed' })
  })
  it('a bad token does nothing at all', async () => {
    expect(await performLinkAction('x.y')).toEqual({ ok: false, reason: 'invalid' })
    expect(prisma.followUp.findUnique).not.toHaveBeenCalled()
  })
  it('actions run as the owner of the row, never as anyone named in the request', async () => {
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue(row({ ownerDiscordId: '222' }) as never)
    await performLinkAction(tok('stop'))
    expect(prisma.messagingOptOut.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { discordId: '222' } }))
  })
})

describe('applyMemberAction snooze', () => {
  it('is refused for someone else', async () => {
    vi.mocked(prisma.followUp.findUnique).mockResolvedValue(row() as never)
    expect(await applyMemberAction({ followUpId: ID, discordId: '999', actorId: 'x', action: 'snooze' })).toEqual({ ok: false, reason: 'not-yours' })
  })
})
