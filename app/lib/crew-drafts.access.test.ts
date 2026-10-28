import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from './db'

vi.mock('./db')
vi.mock('./crew-leads', () => ({ isCrewLead: vi.fn(), isOnCrewRoster: vi.fn() }))
vi.mock('./mission-review-access', () => ({ isDreadPizzaRoberts: vi.fn() }))
vi.mock('./sheets/members-list', () => ({ fetchAllMembers: vi.fn() }))

import { isCrewLead, isOnCrewRoster } from './crew-leads'
import { isDreadPizzaRoberts } from './mission-review-access'
import { fetchAllMembers } from './sheets/members-list'
import { createDraft, getDraftAccess, updateDraft } from './crew-drafts'

const m = (f: unknown) => f as ReturnType<typeof vi.fn>

const row = (over: Record<string, unknown> = {}) => ({
  id: 1, crewId: 'comms', platform: 'X', text: 't', mediaUrl: null, notes: null, status: 'DRAFT',
  createdBy: 'u9', updatedBy: 'u9', postedBy: null, postedAt: null, postedUrl: null,
  createdAt: new Date('2026-10-26'), updatedAt: new Date('2026-10-26'), ...over,
})

function setup(opts: { sheetCrews?: string[]; lead?: boolean; dpr?: boolean; roster?: boolean }) {
  m(fetchAllMembers).mockResolvedValue(opts.sheetCrews ? [{ discordId: 'u1', crews: opts.sheetCrews }] : [])
  m(isCrewLead).mockResolvedValue(!!opts.lead)
  m(isDreadPizzaRoberts).mockResolvedValue(!!opts.dpr)
  m(isOnCrewRoster).mockResolvedValue(!!opts.roster)
}

beforeEach(() => {
  vi.clearAllMocks()
  m(prisma.crewDraft.findUnique).mockResolvedValue(row())
  m(prisma.crewDraft.update).mockImplementation(async ({ data }: { data: Record<string, unknown> }) => row(data))
  m(prisma.crewDraft.create).mockImplementation(async ({ data }: { data: Record<string, unknown> }) => row(data))
})

describe('membership sources and aliases', () => {
  it('accepts the Communications alias on the sheet and canonicalizes the crew id', async () => {
    setup({ sheetCrews: ['Communications'] })
    expect(await getDraftAccess('u1', 'Communications')).toEqual({ member: true, manager: false })
    expect(isOnCrewRoster).not.toHaveBeenCalled() // confirmed on the sheet: no extra lookup
    await createDraft('u1', 'communications', { platform: 'x', text: 'hi' })
    expect(prisma.crewDraft.create).toHaveBeenCalledWith({ data: expect.objectContaining({ crewId: 'comms' }) })
  })
  it('falls back to the crew roster sheet', async () => {
    setup({ roster: true })
    expect(await getDraftAccess('u1', 'comms')).toEqual({ member: true, manager: false })
  })
  it('a lead is a member without the roster lookup', async () => {
    setup({ lead: true })
    expect(await getDraftAccess('u1', 'comms')).toEqual({ member: true, manager: true })
    expect(isOnCrewRoster).not.toHaveBeenCalled()
  })
  it('nobody listed anywhere is not a member', async () => {
    setup({ sheetCrews: ['Tech'] })
    expect(await getDraftAccess('u1', 'comms')).toEqual({ member: false, manager: false })
  })
})

describe('updateDraft is all-or-nothing', () => {
  it('writes nothing when the status change is forbidden, even with edits', async () => {
    setup({ sheetCrews: ['Comms'] })
    m(prisma.crewDraft.findUnique).mockResolvedValue(row({ status: 'READY' }))
    await expect(updateDraft('u1', 'comms', 1, { text: 'edited', status: 'posted' })).rejects.toMatchObject({ statusCode: 403 })
    expect(prisma.crewDraft.update).not.toHaveBeenCalled()
  })
  it('applies edits and status in a single write', async () => {
    setup({ lead: true })
    m(prisma.crewDraft.findUnique).mockResolvedValue(row({ status: 'READY' }))
    await updateDraft('u1', 'comms', 1, { text: 'final', status: 'posted' })
    expect(prisma.crewDraft.update).toHaveBeenCalledTimes(1)
    expect(m(prisma.crewDraft.update).mock.calls[0][0].data).toMatchObject({ text: 'final', status: 'POSTED' })
  })
  it('rejects bodies with no recognized fields', async () => {
    setup({ sheetCrews: ['Comms'] })
    await expect(updateDraft('u1', 'comms', 1, {})).rejects.toMatchObject({ statusCode: 400 })
    await expect(updateDraft('u1', 'comms', 1, { bogus: 1 } as never)).rejects.toMatchObject({ statusCode: 400 })
    expect(prisma.crewDraft.update).not.toHaveBeenCalled()
  })
})
