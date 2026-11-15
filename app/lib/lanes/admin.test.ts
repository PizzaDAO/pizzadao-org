// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/db')

import { prisma } from '@/app/lib/db'
import { createStep, deleteStep, LaneEditError, moveStep, updateLane, updateStep } from './admin'

const m = (f: unknown) => f as ReturnType<typeof vi.fn>
const ADMIN = '400000000000000001'
const lane = { slug: 'host', tag: 'Host', title: 'T', summary: 'S', missionId: null, stretchMissionIds: [], crewId: null, published: false }

beforeEach(() => {
  vi.clearAllMocks()
  m(prisma.lane.findUnique).mockResolvedValue(lane)
})

describe('updateLane', () => {
  it('saves changed fields only, audits each one with the actor and stamps updatedBy', async () => {
    m(prisma.mission.findUnique).mockResolvedValue({ id: 29 })
    const r = await updateLane('host', { title: 'New', summary: 'S', missionId: 29 }, ADMIN, 'why')
    expect(r.changed).toEqual(['title', 'missionId'])
    expect(m(prisma.lane.update).mock.calls[0][0]).toEqual({ where: { slug: 'host' }, data: { title: 'New', missionId: 29, updatedBy: ADMIN } })
    const keys = m(prisma.appSettingChange.create).mock.calls.map((c) => c[0].data)
    expect(keys.map((d: { key: string }) => d.key)).toEqual(['lane:host:title', 'lane:host:missionId'])
    expect(keys[0]).toMatchObject({ changedBy: ADMIN, note: 'why' })
  })
  it('writes nothing when nothing changed', async () => {
    expect(await updateLane('host', { title: 'T' }, ADMIN)).toEqual({ changed: [] })
    expect(prisma.lane.update).not.toHaveBeenCalled()
  })
  it('validates the mission exists and the field limits', async () => {
    m(prisma.mission.findUnique).mockResolvedValue(null)
    await expect(updateLane('host', { missionId: 999 }, ADMIN)).rejects.toThrow(/does not exist/)
    await expect(updateLane('host', { tag: 'x'.repeat(25) }, ADMIN)).rejects.toThrow(/at most 24/)
    await expect(updateLane('host', { title: '  ' }, ADMIN)).rejects.toThrow(/required/)
    await expect(updateLane('host', { crewId: 'Bad Crew!' }, ADMIN)).rejects.toThrow(/crewId/)
    await expect(updateLane('host', { stretchMissionIds: [1, 2, 3, 4, 5, 6] }, ADMIN)).rejects.toThrow(/at most 5/)
    await expect(updateLane('Bad', { title: 'x' }, ADMIN)).rejects.toThrow(LaneEditError)
    expect(prisma.lane.update).not.toHaveBeenCalled()
  })
  it('allows clearing the mission and the crew', async () => {
    m(prisma.lane.findUnique).mockResolvedValue({ ...lane, missionId: 3, crewId: 'events' })
    const r = await updateLane('host', { missionId: null, crewId: '' }, ADMIN)
    expect(r.changed).toEqual(['missionId', 'crewId'])
  })
  it('will not publish a lane with no steps', async () => {
    m(prisma.laneStep.count).mockResolvedValue(0)
    await expect(updateLane('host', { published: true }, ADMIN)).rejects.toThrow(/at least one step/)
    m(prisma.laneStep.count).mockResolvedValue(2)
    expect((await updateLane('host', { published: true }, ADMIN)).changed).toEqual(['published'])
  })
  it('404 for an unknown lane', async () => {
    m(prisma.lane.findUnique).mockResolvedValue(null)
    await expect(updateLane('nope', { title: 'x' }, ADMIN)).rejects.toMatchObject({ status: 404 })
  })
})

describe('createStep', () => {
  it('appends at the end, validates and audits', async () => {
    m(prisma.laneStep.findFirst).mockResolvedValue({ position: 4 })
    m(prisma.laneStep.create).mockResolvedValue({ id: 'new1' })
    const r = await createStep('host', { title: ' Do it ', body: 'Cap is {{hostCapUsd}}.', linkHref: '/handbook/host-a-party#budget', kind: 'read' }, ADMIN)
    expect(r).toEqual({ id: 'new1' })
    expect(m(prisma.laneStep.create).mock.calls[0][0].data).toMatchObject({ laneSlug: 'host', position: 5, title: 'Do it', kind: 'read', linkHref: '/handbook/host-a-party#budget' })
    expect(m(prisma.appSettingChange.create).mock.calls[0][0].data.key).toBe('laneStep:new1:created')
  })
  it('rejects bad links, unknown placeholders and bad kinds', async () => {
    await expect(createStep('host', { title: 'x', linkHref: 'javascript:alert(1)' }, ADMIN)).rejects.toThrow(/https/)
    await expect(createStep('host', { title: 'x', linkHref: 'https://evil.test/' }, ADMIN)).rejects.toThrow(/limited/)
    await expect(createStep('host', { title: 'x', body: '{{notAFact}}' }, ADMIN)).rejects.toThrow(/Unknown placeholder/)
    await expect(createStep('host', { title: 'x', kind: 'weird' }, ADMIN)).rejects.toThrow(/kind/)
    await expect(createStep('host', { title: '' }, ADMIN)).rejects.toThrow(/required/)
    await expect(createStep('host', { title: 'x', body: 'a'.repeat(4001) }, ADMIN)).rejects.toThrow(/4000/)
    expect(prisma.laneStep.create).not.toHaveBeenCalled()
  })
})

describe('updateStep / moveStep / deleteStep', () => {
  const step = { id: 's2', laneSlug: 'host', title: 'B', body: '', linkHref: null, linkLabel: null, kind: 'do', position: 2 }
  it('updates changed fields with audit rows', async () => {
    m(prisma.laneStep.findUnique).mockResolvedValue(step)
    const r = await updateStep('s2', { title: 'C', kind: 'do', linkHref: 'https://rsv.pizza/x' }, ADMIN)
    expect(r.changed).toEqual(['title', 'linkHref'])
    expect(m(prisma.appSettingChange.create).mock.calls.map((c) => c[0].data.key)).toEqual(['laneStep:s2:title', 'laneStep:s2:linkHref'])
  })
  it('moves a step by renumbering the lane 1..n', async () => {
    m(prisma.laneStep.findUnique).mockResolvedValue(step)
    m(prisma.laneStep.findMany).mockResolvedValue([{ id: 's1' }, { id: 's2' }, { id: 's3' }])
    await moveStep('s2', 'up', ADMIN)
    const order = m(prisma.laneStep.update).mock.calls.map((c) => [c[0].where.id, c[0].data.position])
    expect(order).toEqual([['s2', 1], ['s1', 2], ['s3', 3]])
  })
  it('moving the first step up is a no-op', async () => {
    m(prisma.laneStep.findUnique).mockResolvedValue({ ...step, id: 's1' })
    m(prisma.laneStep.findMany).mockResolvedValue([{ id: 's1' }, { id: 's2' }])
    await moveStep('s1', 'up', ADMIN)
    expect(prisma.laneStep.update).not.toHaveBeenCalled()
  })
  it('deletes with an audit row', async () => {
    m(prisma.laneStep.findUnique).mockResolvedValue(step)
    await deleteStep('s2', ADMIN)
    expect(prisma.laneStep.delete).toHaveBeenCalledWith({ where: { id: 's2' } })
    expect(m(prisma.appSettingChange.create).mock.calls[0][0].data.key).toBe('laneStep:s2:deleted')
  })
  it('404 for an unknown step', async () => {
    m(prisma.laneStep.findUnique).mockResolvedValue(null)
    await expect(updateStep('x', { title: 'y' }, ADMIN)).rejects.toMatchObject({ status: 404 })
    await expect(deleteStep('x', ADMIN)).rejects.toMatchObject({ status: 404 })
  })
})
