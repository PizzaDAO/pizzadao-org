// @vitest-environment node
// The taskId / requireOpen / awaitActivation branches added for the Discord /task command. The
// label-based paths are pinned by app/api/claim-task/__tests__/route.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  getCrewMappings: vi.fn(),
  usesDb: vi.fn(),
  fetchMemberByDiscordId: vi.fn(),
  fetchMemberIdByDiscordId: vi.fn(),
  recordActivation: vi.fn(),
  recordActivationLater: vi.fn(),
  prisma: {
    crewTask: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    crewTaskEvent: { create: vi.fn() },
    taskClaimEvent: { upsert: vi.fn() },
  },
}))
vi.mock('@/app/lib/db', () => ({ prisma: m.prisma }))
vi.mock('@/app/lib/crew-mappings', async () => {
  const actual = await vi.importActual<typeof import('@/app/lib/crew-mappings')>('@/app/lib/crew-mappings')
  return { ...actual, getCrewMappings: m.getCrewMappings }
})
vi.mock('@/app/lib/sheets-import/source', () => ({ usesDb: m.usesDb }))
vi.mock('@/app/lib/sheets/member-repository', () => ({ fetchMemberByDiscordId: m.fetchMemberByDiscordId, fetchMemberIdByDiscordId: m.fetchMemberIdByDiscordId }))
vi.mock('@/app/lib/activation', () => ({ recordActivation: m.recordActivation, recordActivationLater: m.recordActivationLater }))
vi.mock('@/app/lib/google-auth', () => ({ getGoogleAuth: () => ({}), GOOGLE_SCOPES: { sheets: 's' } }))
vi.mock('googleapis', () => ({ google: { sheets: () => ({}) } }))

import { claimCrewTask } from '../claim-task'

const base = { discordId: 'd1', taskId: 'task1' }
const found = (over: Record<string, unknown> = {}) => ({ id: 'task1', label: ' Bake bread ', leadMemberId: null, stage: 'todo', crewId: 'ops', ...over })

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  m.getCrewMappings.mockResolvedValue({ crews: [{ id: 'ops', label: 'Ops', sheet: 'https://docs.google.com/spreadsheets/d/S1/edit' }, { id: 'old', label: 'Old' }] })
  m.usesDb.mockImplementation(async (_k: string, id: string) => id === 'ops')
  m.fetchMemberByDiscordId.mockResolvedValue({ memberId: 42, name: 'Mario' })
  m.prisma.crewTask.findFirst.mockResolvedValue(found())
  m.prisma.crewTask.updateMany.mockResolvedValue({ count: 1 })
  m.prisma.crewTaskEvent.create.mockResolvedValue({})
  m.prisma.taskClaimEvent.upsert.mockResolvedValue({})
})

describe('claimCrewTask by taskId', () => {
  it('claims by id and returns the task', async () => {
    const r = await claimCrewTask({ ...base, action: 'claim', requireOpen: true })
    expect(r).toEqual({ ok: true, action: 'claim', task: { id: 'task1', label: 'Bake bread', crewId: 'ops' } })
    expect(m.prisma.crewTask.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'task1', archived: false } }))
    expect(m.prisma.crewTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'task1' }) }))
    expect(m.prisma.crewTaskEvent.create).toHaveBeenCalledWith({ data: { taskId: 'task1', crewId: 'ops', action: 'claim', actor: 'd1' } })
    expect(m.prisma.taskClaimEvent.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ taskKey: 'S1::Bake bread', sheetUrl: null }) }))
  })

  it('404s an archived or unknown task, and scopes to the crew when crewId is given', async () => {
    m.prisma.crewTask.findFirst.mockResolvedValue(null)
    expect(await claimCrewTask({ ...base, action: 'claim' })).toMatchObject({ ok: false, status: 404 })
    await claimCrewTask({ ...base, action: 'claim', crewId: 'Art' })
    expect(m.prisma.crewTask.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: 'task1', archived: false, crewId: 'art' } }))
    expect(m.prisma.crewTask.updateMany).not.toHaveBeenCalled()
  })

  it('404s a task whose crew still reads from the sheet', async () => {
    m.prisma.crewTask.findFirst.mockResolvedValue(found({ crewId: 'old' }))
    expect(await claimCrewTask({ ...base, action: 'claim' })).toMatchObject({ ok: false, status: 404 })
  })

  it('requireOpen refuses a closed task with 409, but still lets you drop it', async () => {
    m.prisma.crewTask.findFirst.mockResolvedValue(found({ stage: 'Done' }))
    expect(await claimCrewTask({ ...base, action: 'claim', requireOpen: true })).toEqual({ ok: false, status: 409, error: 'That task is closed' })
    expect(m.prisma.crewTask.updateMany).not.toHaveBeenCalled()
    m.prisma.crewTask.findFirst.mockResolvedValue(found({ stage: 'Done', leadMemberId: '42' }))
    expect(await claimCrewTask({ ...base, action: 'giveup', requireOpen: true })).toMatchObject({ ok: true })
  })

  it('without requireOpen a closed task can still be claimed (as on the web)', async () => {
    m.prisma.crewTask.findFirst.mockResolvedValue(found({ stage: 'Done' }))
    expect(await claimCrewTask({ ...base, action: 'claim' })).toMatchObject({ ok: true })
  })

  it('409s a task someone else leads', async () => {
    m.prisma.crewTask.findFirst.mockResolvedValue(found({ leadMemberId: '7' }))
    expect(await claimCrewTask({ ...base, action: 'claim' })).toMatchObject({ ok: false, status: 409 })
  })

  it('schedules the activation by default and awaits it when asked', async () => {
    await claimCrewTask({ ...base, action: 'claim' })
    expect(m.recordActivationLater).toHaveBeenCalledWith('first_contribution', { discordId: 'd1', code: 'task_claim' })
    expect(m.recordActivation).not.toHaveBeenCalled()
    m.recordActivationLater.mockClear()
    await claimCrewTask({ ...base, action: 'claim', awaitActivation: true })
    expect(m.recordActivation).toHaveBeenCalledWith('first_contribution', { discordId: 'd1', code: 'task_claim' })
    expect(m.recordActivationLater).not.toHaveBeenCalled()
  })
})
