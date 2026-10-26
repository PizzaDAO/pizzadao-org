import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from './db'

vi.mock('./db')
vi.mock('./crew-leads', () => ({ isCrewLead: vi.fn() }))
vi.mock('./mission-review-access', () => ({ canReviewMission: vi.fn() }))
vi.mock('./sheets/members-list', () => ({ fetchAllMembers: vi.fn() }))

import { isCrewLead } from './crew-leads'
import { canReviewMission } from './mission-review-access'
import { fetchAllMembers } from './sheets/members-list'
import { crewHasFeature } from './crew-features'
import { createDraft, listDrafts, editDraft, changeDraftStatus, getDraftAccess } from './crew-drafts'

const m = (f: unknown) => f as ReturnType<typeof vi.fn>

function who(role: 'member' | 'lead' | 'dpr' | 'outsider') {
  m(fetchAllMembers).mockResolvedValue([
    { discordId: 'u1', crews: role === 'outsider' ? ['Tech'] : ['Comms'] },
  ])
  m(isCrewLead).mockResolvedValue(role === 'lead')
  m(canReviewMission).mockResolvedValue(role === 'dpr')
}

const row = (over: Record<string, unknown> = {}) => ({
  id: 1, crewId: 'comms', platform: 'X', text: 't', mediaUrl: null, notes: null, status: 'DRAFT',
  createdBy: 'u9', updatedBy: 'u9', postedBy: null, postedAt: null, postedUrl: null,
  createdAt: new Date('2026-10-26'), updatedAt: new Date('2026-10-26'), ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  m(prisma.crewDraft.findUnique).mockResolvedValue(row())
  m(prisma.crewDraft.update).mockImplementation(async ({ data }: { data: Record<string, unknown> }) => row(data))
  m(prisma.crewDraft.create).mockImplementation(async ({ data }: { data: Record<string, unknown> }) => row(data))
  m(prisma.crewDraft.findMany).mockResolvedValue([row()])
})

describe('feature flag', () => {
  it('is on for comms only', () => {
    expect(crewHasFeature('comms', 'drafts')).toBe(true)
    expect(crewHasFeature('Comms', 'drafts')).toBe(true)
    expect(crewHasFeature('tech', 'drafts')).toBe(false)
  })
  it('404s for crews without the feature', async () => {
    who('lead')
    await expect(listDrafts('u1', 'tech')).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('permissions', () => {
  it('non-members see nothing and cannot create', async () => {
    who('outsider')
    expect(await getDraftAccess('u1', 'comms')).toEqual({ member: false, manager: false })
    await expect(listDrafts('u1', 'comms')).rejects.toMatchObject({ statusCode: 403 })
    await expect(createDraft('u1', 'comms', { platform: 'x', text: 'hi' })).rejects.toMatchObject({ statusCode: 403 })
    expect(prisma.crewDraft.create).not.toHaveBeenCalled()
  })
  it('members create, edit and mark ready', async () => {
    who('member')
    const d = await createDraft('u1', 'comms', { platform: 'x', text: ' hi ' })
    expect(d.text).toBe('hi')
    expect(prisma.crewDraft.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ crewId: 'comms', platform: 'X', createdBy: 'u1', updatedBy: 'u1' }),
    })
    await expect(editDraft('u1', 'comms', 1, { text: 'new' })).resolves.toBeTruthy()
    const r = await changeDraftStatus('u1', 'comms', 1, 'ready')
    expect(r.status).toBe('ready')
  })
  it('members cannot mark posted or archive', async () => {
    who('member')
    m(prisma.crewDraft.findUnique).mockResolvedValue(row({ status: 'READY' }))
    await expect(changeDraftStatus('u1', 'comms', 1, 'posted')).rejects.toMatchObject({ statusCode: 403 })
    await expect(changeDraftStatus('u1', 'comms', 1, 'archived')).rejects.toMatchObject({ statusCode: 403 })
    expect(prisma.crewDraft.update).not.toHaveBeenCalled()
  })
  it('leads mark posted (records poster, time, url)', async () => {
    who('lead')
    m(prisma.crewDraft.findUnique).mockResolvedValue(row({ status: 'READY' }))
    const r = await changeDraftStatus('u1', 'comms', 1, 'posted', { postedUrl: 'https://x.com/p/status/1' })
    expect(r.status).toBe('posted')
    expect(r.postedBy).toBe('u1')
    expect(r.postedAt).toBeTruthy()
    expect(r.postedUrl).toBe('https://x.com/p/status/1')
  })
  it('Dread Pizza Roberts (non-member) can manage', async () => {
    m(fetchAllMembers).mockResolvedValue([])
    m(isCrewLead).mockResolvedValue(false)
    m(canReviewMission).mockResolvedValue(true)
    expect(await getDraftAccess('u1', 'comms')).toEqual({ member: true, manager: true })
    expect(canReviewMission).toHaveBeenCalledWith('u1', 8)
  })
  it('fails closed when the member lookup errors', async () => {
    m(fetchAllMembers).mockRejectedValue(new Error('sheet down'))
    m(isCrewLead).mockResolvedValue(false)
    m(canReviewMission).mockResolvedValue(false)
    expect(await getDraftAccess('u1', 'comms')).toEqual({ member: false, manager: false })
  })
})

describe('status rules', () => {
  it('rejects invalid transitions', async () => {
    who('lead')
    await expect(changeDraftStatus('u1', 'comms', 1, 'posted')).rejects.toMatchObject({ statusCode: 400 })
  })
  it('rejects non-https posted urls', async () => {
    who('lead')
    m(prisma.crewDraft.findUnique).mockResolvedValue(row({ status: 'READY' }))
    await expect(
      changeDraftStatus('u1', 'comms', 1, 'posted', { postedUrl: 'javascript:alert(1)' }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })
  it('freezes posted drafts', async () => {
    who('lead')
    m(prisma.crewDraft.findUnique).mockResolvedValue(row({ status: 'POSTED' }))
    await expect(editDraft('u1', 'comms', 1, { text: 'x' })).rejects.toMatchObject({ statusCode: 403 })
  })
  it('does not reach drafts of another crew', async () => {
    who('lead')
    m(prisma.crewDraft.findUnique).mockResolvedValue(row({ crewId: 'tech' }))
    await expect(changeDraftStatus('u1', 'comms', 1, 'ready')).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('archive instead of delete', () => {
  it('archiving updates status and never deletes', async () => {
    who('lead')
    const r = await changeDraftStatus('u1', 'comms', 1, 'archived')
    expect(r.status).toBe('archived')
    expect(prisma.crewDraft.delete).not.toHaveBeenCalled()
    expect(prisma.crewDraft.deleteMany).not.toHaveBeenCalled()
  })
  it('lists hide archived by default', async () => {
    who('member')
    await listDrafts('u1', 'comms')
    expect(m(prisma.crewDraft.findMany).mock.calls[0][0].where).toEqual({
      crewId: 'comms',
      status: { not: 'ARCHIVED' },
    })
    await listDrafts('u1', 'comms', { includeArchived: true })
    expect(m(prisma.crewDraft.findMany).mock.calls[1][0].where).toEqual({ crewId: 'comms' })
  })
})

describe('validation', () => {
  it('rejects bad platform, empty text, non-https media', async () => {
    who('member')
    await expect(createDraft('u1', 'comms', { platform: 'myspace', text: 'a' })).rejects.toMatchObject({ statusCode: 400 })
    await expect(createDraft('u1', 'comms', { platform: 'x', text: '  ' })).rejects.toMatchObject({ statusCode: 400 })
    await expect(
      createDraft('u1', 'comms', { platform: 'x', text: 'a', mediaUrl: 'http://x.io' }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })
})
