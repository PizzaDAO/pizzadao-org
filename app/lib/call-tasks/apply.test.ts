// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/lib/db')
vi.mock('@/app/lib/crew-leads', () => ({ canManageCrew: vi.fn() }))
vi.mock('@/app/lib/sheets-import/source', () => ({ usesDb: vi.fn() }))
vi.mock('@/app/lib/crew-mappings', async (orig) => ({ ...(await orig<typeof import('@/app/lib/crew-mappings')>()), invalidateCrewMappingsCache: vi.fn(async () => {}) }))

import { prisma } from '@/app/lib/db'
import { canManageCrew } from '@/app/lib/crew-leads'
import { usesDb } from '@/app/lib/sheets-import/source'
import { applyAll, applyProposal, cleanEdits, dismissProposal, effectiveValues } from './apply'

const prop = vi.mocked(prisma.crewTaskProposal)
const task = vi.mocked(prisma.crewTask)
const event = vi.mocked(prisma.crewTaskEvent)

const BASE = new Date('2026-11-01T00:00:00Z')
const row = (over: Record<string, unknown> = {}) => ({
  id: 'p1', recordingId: 'rec1', crewId: 'ops', kind: 'UPDATE', taskId: 't1', baseUpdatedAt: BASE,
  changes: { stage: { from: 'doing', to: 'done' } }, edited: null, leadMemberId: null, candidates: null, status: 'PENDING', ...over,
})
const dbTask = (over: Record<string, unknown> = {}) => ({ id: 't1', crewId: 'ops', label: 'Order stickers', stage: 'doing', priority: null, due: null, dueRaw: null, leadName: null, leadMemberId: null, doneAt: null, archived: false, updatedAt: BASE, ...over })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(canManageCrew).mockResolvedValue(true)
  vi.mocked(usesDb).mockResolvedValue(true)
  prop.updateMany.mockResolvedValue({ count: 1 })
  task.updateMany.mockResolvedValue({ count: 1 })
  task.findMany.mockResolvedValue([])
  task.create.mockResolvedValue({ id: 'new1' } as never)
  event.create.mockResolvedValue({} as never)
})

describe('applyProposal', () => {
  it('applies a DONE: stamps doneAt, writes the history with the proposal id, marks APPLIED', async () => {
    prop.findUnique.mockResolvedValue(row() as never)
    task.findFirst.mockResolvedValue(dbTask() as never)
    const r = await applyProposal('p1', 'lead1')
    expect(r).toEqual({ result: 'applied', taskId: 't1' })
    const upd = task.updateMany.mock.calls[0][0] as { where: Record<string, unknown>; data: Record<string, unknown> }
    expect(upd.where.updatedAt).toEqual(BASE) // the stale check is part of the write
    expect(upd.data.stage).toBe('done')
    expect(upd.data.doneAt).toBeInstanceOf(Date)
    expect(upd.data.updatedBy).toBe('lead1')
    const ev = event.create.mock.calls[0][0] as { data: { action: string; actor: string; data: Record<string, unknown> } }
    expect(ev.data.action).toBe('update')
    expect(ev.data.actor).toBe('lead1')
    expect(ev.data.data).toMatchObject({ via: 'call-proposal', proposalId: 'p1', recordingId: 'rec1' })
    expect(prop.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 'p1', status: 'PENDING' }, data: { status: 'APPLIED', decidedBy: 'lead1' } })
  })

  it('fails closed for anyone who cannot manage the crew, and for crews still on the sheet', async () => {
    prop.findUnique.mockResolvedValue(row() as never)
    vi.mocked(canManageCrew).mockResolvedValue(false)
    expect(await applyProposal('p1', 'someone')).toEqual({ result: 'forbidden' })
    vi.mocked(canManageCrew).mockResolvedValue(true)
    vi.mocked(usesDb).mockResolvedValue(false)
    expect(await applyProposal('p1', 'lead1')).toEqual({ result: 'not-db-crew' })
    expect(task.updateMany).not.toHaveBeenCalled()
    expect(prop.updateMany).not.toHaveBeenCalled()
  })

  it('asks for a second confirmation when the task changed since the proposal, then applies with force', async () => {
    prop.findUnique.mockResolvedValue(row() as never)
    const changed = dbTask({ updatedAt: new Date('2026-11-02T00:00:00Z'), stage: 'now' })
    task.findFirst.mockResolvedValue(changed as never)
    const r = await applyProposal('p1', 'lead1')
    expect(r).toMatchObject({ result: 'conflict', current: { stage: 'now' } })
    expect(task.updateMany).not.toHaveBeenCalled()
    expect(prop.updateMany).not.toHaveBeenCalled() // still pending
    const forced = await applyProposal('p1', 'lead1', { force: true })
    expect(forced.result).toBe('applied')
    expect((task.updateMany.mock.calls[0][0] as { where: Record<string, unknown> }).where.updatedAt).toEqual(changed.updatedAt) // re-based
  })

  it('releases the claim when the task changes between the check and the write', async () => {
    prop.findUnique.mockResolvedValue(row() as never)
    task.findFirst.mockResolvedValue(dbTask() as never)
    task.updateMany.mockResolvedValue({ count: 0 })
    task.findUnique.mockResolvedValue(dbTask({ stage: 'now' }) as never)
    const r = await applyProposal('p1', 'lead1')
    expect(r.result).toBe('conflict')
    expect(prop.updateMany).toHaveBeenLastCalledWith({ where: { id: 'p1' }, data: expect.objectContaining({ status: 'PENDING' }) })
    expect(event.create).not.toHaveBeenCalled()
  })

  it('two clicks cannot apply the same proposal twice', async () => {
    prop.findUnique.mockResolvedValue(row() as never)
    task.findFirst.mockResolvedValue(dbTask() as never)
    prop.updateMany.mockResolvedValue({ count: 0 }) // someone else claimed it
    expect(await applyProposal('p1', 'lead1')).toEqual({ result: 'not-pending' })
    expect(task.updateMany).not.toHaveBeenCalled()
  })

  it('does nothing for a decided proposal', async () => {
    prop.findUnique.mockResolvedValue(row({ status: 'APPLIED' }) as never)
    expect(await applyProposal('p1', 'lead1')).toEqual({ result: 'not-pending' })
  })

  it('RETIRE archives the task and never deletes', async () => {
    prop.findUnique.mockResolvedValue(row({ kind: 'RETIRE', changes: { archived: { from: false, to: true } } }) as never)
    task.findFirst.mockResolvedValue(dbTask() as never)
    expect((await applyProposal('p1', 'lead1')).result).toBe('applied')
    expect(task.updateMany.mock.calls[0][0]).toMatchObject({ data: { archived: true } })
    expect(task.delete).not.toHaveBeenCalled()
    expect(task.deleteMany).not.toHaveBeenCalled()
    expect((event.create.mock.calls[0][0] as { data: { action: string } }).data.action).toBe('archive')
  })

  it('CREATE adds the task at the end of the list with a create event', async () => {
    prop.findUnique.mockResolvedValue(row({ kind: 'CREATE', taskId: null, baseUpdatedAt: null, changes: { label: { from: null, to: 'Print flyers' }, leadName: { from: null, to: 'Bob' }, leadMemberId: { from: null, to: '12' } } }) as never)
    task.findMany.mockResolvedValue([{ naturalKey: 'print flyers', position: 4 }] as never)
    const r = await applyProposal('p1', 'lead1')
    expect(r).toEqual({ result: 'applied', taskId: 'new1' })
    const data = (task.create.mock.calls[0][0] as { data: Record<string, unknown> }).data
    expect(data).toMatchObject({ crewId: 'ops', label: 'Print flyers', position: 5, leadMemberId: '12', createdBy: 'lead1', naturalKey: 'print flyers#2' })
    expect((event.create.mock.calls[0][0] as { data: { action: string; data: Record<string, unknown> } }).data).toMatchObject({ action: 'create', data: { via: 'call-proposal', proposalId: 'p1' } })
  })

  it('applies the approver\'s edits instead of the proposal and records them', async () => {
    prop.findUnique.mockResolvedValue(row({ changes: { stage: { from: 'doing', to: 'done' } } }) as never)
    task.findFirst.mockResolvedValue(dbTask() as never)
    await applyProposal('p1', 'lead1', { edits: { stage: 'now', due: '2026-12-01', priority: 'High' } })
    expect(task.updateMany.mock.calls[0][0]).toMatchObject({ data: { stage: 'now', due: '2026-12-01', priority: 'High', doneAt: null } })
    expect(prop.updateMany.mock.calls[0][0]).toMatchObject({ data: { edited: { stage: 'now', due: '2026-12-01', priority: 'High' } } })
  })

  it('rejects malformed edits', async () => {
    prop.findUnique.mockResolvedValue(row() as never)
    expect(await applyProposal('p1', 'lead1', { edits: { due: 'tomorrow' } })).toEqual({ result: 'bad-edits' })
    expect(prop.updateMany).not.toHaveBeenCalled()
  })

  it('an ambiguous lead has to be picked or skipped', async () => {
    const ambiguous = row({ changes: { stage: { from: 'doing', to: 'now' } }, candidates: [{ memberId: '13', name: 'Sam Roe' }, { memberId: '14', name: 'Sam Rowe' }] })
    prop.findUnique.mockResolvedValue(ambiguous as never)
    task.findFirst.mockResolvedValue(dbTask() as never)
    expect(await applyProposal('p1', 'lead1')).toEqual({ result: 'needs-lead' })
    expect((await applyProposal('p1', 'lead1', { edits: { leadMemberId: '13', leadName: 'Sam Roe' } })).result).toBe('applied')
    expect(task.updateMany.mock.calls[0][0]).toMatchObject({ data: { stage: 'now', leadMemberId: '13', leadName: 'Sam Roe' } })
    task.updateMany.mockClear()
    expect((await applyProposal('p1', 'lead1', { edits: { skipLead: true } })).result).toBe('applied')
  })

  it('marks a proposal stale when its task is gone', async () => {
    prop.findUnique.mockResolvedValue(row() as never)
    task.findFirst.mockResolvedValue(null)
    expect(await applyProposal('p1', 'lead1')).toEqual({ result: 'missing-task' })
    expect(prop.updateMany.mock.calls[0][0]).toMatchObject({ data: { status: 'STALE' } })
  })
})

describe('dismissProposal', () => {
  it('only a manager can dismiss, and only a pending one', async () => {
    prop.findUnique.mockResolvedValue({ crewId: 'ops', status: 'PENDING' } as never)
    vi.mocked(canManageCrew).mockResolvedValue(false)
    expect(await dismissProposal('p1', 'x')).toBe('forbidden')
    vi.mocked(canManageCrew).mockResolvedValue(true)
    expect(await dismissProposal('p1', 'lead1')).toBe('dismissed')
    prop.findUnique.mockResolvedValue({ crewId: 'ops', status: 'APPLIED' } as never)
    expect(await dismissProposal('p1', 'lead1')).toBe('not-pending')
  })
})

describe('applyAll', () => {
  it('applies what needs no decision and reports the rest', async () => {
    prop.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }] as never)
    prop.findUnique.mockImplementation((async ({ where }: { where: { id: string } }) => {
      if (where.id === 'a') return row({ id: 'a' })
      if (where.id === 'b') return row({ id: 'b', taskId: 't2' })
      return row({ id: 'c', taskId: 't3', candidates: [{ memberId: '13', name: 'X' }], changes: { stage: { from: 'doing', to: 'now' } } })
    }) as never)
    task.findFirst.mockImplementation((async ({ where }: { where: { id: string } }) =>
      where.id === 't2' ? dbTask({ id: 't2', updatedAt: new Date('2026-11-05T00:00:00Z') }) : dbTask({ id: where.id })) as never)
    const r = await applyAll('ops', 'lead1')
    expect(r).toEqual({ applied: 1, skipped: [{ id: 'b', reason: 'conflict' }, { id: 'c', reason: 'needs-lead' }] })
  })

  it('fails closed', async () => {
    vi.mocked(canManageCrew).mockResolvedValue(false)
    expect(await applyAll('ops', 'x')).toBe('forbidden')
    expect(prop.findMany).not.toHaveBeenCalled()
  })
})

describe('edits', () => {
  it('cleanEdits validates and normalises', () => {
    expect(cleanEdits(undefined)).toEqual({})
    expect(cleanEdits({ label: '  New   thing ', due: '2026-12-01', leadMemberId: '12' })).toEqual({ label: 'New thing', due: '2026-12-01', leadMemberId: '12' })
    expect(cleanEdits({ due: '12/01' })).toBeNull()
    expect(cleanEdits({ leadMemberId: 'abc' })).toBeNull()
    expect(cleanEdits({ stage: 5 })).toBeNull()
    expect(cleanEdits([])).toBeNull()
  })
  it('effectiveValues lets edits win and a typed lead name drops the stale member id', () => {
    const changes = { stage: { from: 'a', to: 'done' }, leadName: { from: null, to: 'Bob' }, leadMemberId: { from: null, to: '12' } }
    expect(effectiveValues(changes, {})).toEqual({ stage: 'done', leadName: 'Bob', leadMemberId: '12' })
    expect(effectiveValues(changes, { stage: 'now', leadName: 'Zed' })).toEqual({ stage: 'now', leadName: 'Zed', leadMemberId: null })
    expect(effectiveValues(changes, { skipLead: true })).toEqual({ stage: 'done' })
  })
})
