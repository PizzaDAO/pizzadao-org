// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/db')
vi.mock('@/app/lib/mission-cache', () => ({ clearMissionCaches: vi.fn() }))

import { prisma } from '@/app/lib/db'
import { clearMissionCaches } from '@/app/lib/mission-cache'
import { clearSettingsCache } from '@/app/lib/settings'
import { assertStricterParams, MissionEditError, updateLevel, updateMission, validateVerifierParams } from './admin-missions'

const m = (f: unknown) => f as ReturnType<typeof vi.fn>
const ADMIN = '400000000000000001'

const vouch = { id: 7, level: 6, index: 2, title: 'Get vouched by 5 members', description: 'd', isActive: true, verifierKey: 'vouch_received', verifierParams: { min: 5, sources: ['PIZZADAO'] }, reward: 6942, levelTitle: 'T' }

beforeEach(() => {
  vi.clearAllMocks()
  clearSettingsCache({ all: true })
  m(prisma.appSetting.findMany).mockResolvedValue([])
  m(prisma.mission.findUnique).mockResolvedValue(vouch)
  m(prisma.mission.updateMany).mockResolvedValue({ count: 1 })
})

describe('validateVerifierParams (each verifier\'s own parse + bounds)', () => {
  it('accepts valid params for known verifiers', () => {
    expect(validateVerifierParams('vouch_received', { min: 3, sources: ['PIZZADAO'] })).toEqual({ min: 3, sources: ['PIZZADAO'] })
    expect(validateVerifierParams('attendance_count', { min: 2 })).toEqual({ min: 2 })
    expect(validateVerifierParams('referral', { min: 2 })).toEqual({ min: 2 })
    expect(validateVerifierParams('rare_pizza_box', { minLevel: 4 })).toEqual({ minLevel: 4 })
    expect(validateVerifierParams('discord_role', { roleIds: ['812131585327235113'] })).toEqual({ roleIds: ['812131585327235113'] })
  })

  it('rejects what the verifier rejects', () => {
    expect(() => validateVerifierParams('vouch_received', { min: 0 })).toThrow(MissionEditError)
    expect(() => validateVerifierParams('vouch_received', { min: 2.5 })).toThrow(/positive integer/)
    expect(() => validateVerifierParams('vouch_received', { min: 2, sources: ['NOPE'] })).toThrow(/sources/)
    expect(() => validateVerifierParams('discord_role', { roleIds: ['abc'] })).toThrow(/snowflakes/)
    expect(() => validateVerifierParams('discord_role', {})).toThrow(/required/)
    expect(() => validateVerifierParams('attendance_count', { min: 1, crews: 'some' })).toThrow(/crews/)
  })

  it('adds bounds on top: counts 1..100, minLevel 1..8', () => {
    expect(() => validateVerifierParams('vouch_received', { min: 101 })).toThrow(/1 to 100/)
    expect(() => validateVerifierParams('rare_pizza_box', { minLevel: 9 })).toThrow(/1 to 8/)
    expect(() => validateVerifierParams('rare_pizza_box', { minLevel: 0 })).toThrow()
  })

  it('rejects non-objects, arrays, oversize params, missions without a verifier and unknown verifiers', () => {
    expect(() => validateVerifierParams('vouch_received', [] as never)).toThrow(/object/)
    expect(() => validateVerifierParams('vouch_received', 'x')).toThrow(/object/)
    expect(() => validateVerifierParams('vouch_received', { min: 1, junk: 'x'.repeat(5000) })).toThrow(/too large/)
    expect(() => validateVerifierParams(null, { min: 1 })).toThrow(/no verifier/)
    expect(() => validateVerifierParams('nope', { min: 1 })).toThrow(/Unknown verifier/)
  })
})

describe('updateMission', () => {
  it('saves valid params, audits who/old/new in the same transaction and clears the caches', async () => {
    const r = await updateMission(7, { verifierParams: { min: 6, sources: ['PIZZADAO'] } }, ADMIN, { confirm: true })
    expect(r.changed).toEqual(['verifierParams'])
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(prisma.mission.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { verifierParams: { min: 6, sources: ['PIZZADAO'] } } }))
    expect(prisma.appSettingChange.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ key: 'mission:7:verifierParams', oldValue: { min: 5, sources: ['PIZZADAO'] }, newValue: { min: 6, sources: ['PIZZADAO'] }, changedBy: ADMIN }),
    })
    expect(clearMissionCaches).toHaveBeenCalled()
  })

  it('a parse() rejection is a 400 and writes nothing', async () => {
    await expect(updateMission(7, { verifierParams: { min: 0 } }, ADMIN)).rejects.toMatchObject({ status: 400 })
    expect(prisma.mission.updateMany).not.toHaveBeenCalled()
    expect(prisma.appSettingChange.create).not.toHaveBeenCalled()
    expect(clearMissionCaches).not.toHaveBeenCalled()
  })

  it('a minimum cannot go below the CODE value (5 for this mission), even with confirm', async () => {
    await expect(updateMission(7, { verifierParams: { min: 4, sources: ['PIZZADAO'] } }, ADMIN, { confirm: true })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/can't go below 5.*PR/) })
    expect(prisma.mission.updateMany).not.toHaveBeenCalled()
  })

  it('every params change shows old -> new in a 409 confirm, and writes nothing until confirmed', async () => {
    const err = await updateMission(7, { verifierParams: { min: 6, sources: ['PIZZADAO'] } }, ADMIN).catch((e) => e)
    expect(err).toMatchObject({ status: 409 })
    expect(err.needsConfirm).toMatch(/min 5 -> 6/)
    expect(prisma.mission.updateMany).not.toHaveBeenCalled()
  })

  it('a typo can be undone: from 9 back down to the code value 5 is allowed (with confirm)', async () => {
    m(prisma.mission.findUnique).mockResolvedValue({ ...vouch, verifierParams: { min: 9, sources: ['PIZZADAO'] } })
    const err = await updateMission(7, { verifierParams: { min: 5, sources: ['PIZZADAO'] } }, ADMIN).catch((e) => e)
    expect(err.needsConfirm).toMatch(/min 9 -> 5/)
    await expect(updateMission(7, { verifierParams: { min: 5, sources: ['PIZZADAO'] } }, ADMIN, { confirm: true })).resolves.toEqual({ changed: ['verifierParams'] })
    await expect(updateMission(7, { verifierParams: { min: 4, sources: ['PIZZADAO'] } }, ADMIN, { confirm: true })).rejects.toMatchObject({ status: 400 })
  })

  it('minLevel is read-only (raising it above the mission level would make it impossible)', async () => {
    m(prisma.mission.findUnique).mockResolvedValue({ ...vouch, level: 5, index: 3, verifierKey: 'rare_pizza_box', verifierParams: { minLevel: 5 } })
    await expect(updateMission(7, { verifierParams: { minLevel: 6 } }, ADMIN, { confirm: true })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/minLevel can't be changed/) })
    await expect(updateMission(7, { verifierParams: { minLevel: 4 } }, ADMIN, { confirm: true })).rejects.toMatchObject({ status: 400 })
  })

  it('the verifierParams guard is part of the update\'s where clause', async () => {
    await updateMission(7, { verifierParams: { min: 6, sources: ['PIZZADAO'] } }, ADMIN, { confirm: true })
    expect(prisma.mission.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ verifierParams: { equals: vouch.verifierParams } }) }))
  })

  it('non-numeric params are read-only: sources, roles, added or removed keys', async () => {
    await expect(updateMission(7, { verifierParams: { min: 5, sources: ['PIZZADAO', 'OTHER'] } }, ADMIN)).rejects.toMatchObject({ status: 400 })
    await expect(updateMission(7, { verifierParams: { min: 5 } }, ADMIN)).rejects.toMatchObject({ status: 400 })
    await expect(updateMission(7, { verifierParams: { min: 5, sources: ['PIZZADAO'], minLikes: 2 } }, ADMIN)).rejects.toMatchObject({ status: 400 })
    expect(prisma.mission.updateMany).not.toHaveBeenCalled()
  })

  it('assertStricterParams: only numeric minimums at or above the code value pass', () => {
    const code = { min: 1, minLikes: 10 }
    expect(() => assertStricterParams({ min: 1, minLikes: 12 }, { minLikes: 11, min: 1 }, code)).not.toThrow()
    expect(() => assertStricterParams({ min: 1, minLikes: 12 }, { minLikes: 10, min: 1 }, code)).not.toThrow()
    expect(() => assertStricterParams({ min: 1, minLikes: 12 }, { minLikes: 9, min: 1 }, code)).toThrow(/can't go below 10/)
    expect(() => assertStricterParams({ minLevel: 5 }, { minLevel: 6 })).toThrow(/can't be changed/)
    expect(() => assertStricterParams({ roleIds: ['1'] }, { roleIds: ['2'] })).toThrow(/can't be changed/)
    expect(() => assertStricterParams({ min: 1, crews: 'any' }, { min: 1, crews: 'all' })).toThrow()
    expect(() => assertStricterParams({ min: 1 }, { min: '2' as never })).toThrow()
  })

  it('raising a count is allowed once confirmed', async () => {
    await expect(updateMission(7, { verifierParams: { min: 9, sources: ['PIZZADAO'] } }, ADMIN, { confirm: true })).resolves.toMatchObject({ changed: ['verifierParams'] })
  })

  it('edits title and description, one audit row per changed field', async () => {
    const r = await updateMission(7, { title: ' New title ', description: null }, ADMIN)
    expect(r.changed.sort()).toEqual(['description', 'title'])
    expect(prisma.mission.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { title: 'New title', description: null } }))
    expect(prisma.appSettingChange.create).toHaveBeenCalledTimes(2)
  })

  it('refuses to deactivate (an inactive mission makes the level count as complete); re-activating is fine', async () => {
    await expect(updateMission(7, { isActive: false }, ADMIN, { confirm: true })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/Deactivating a mission needs a PR/) })
    expect(prisma.mission.updateMany).not.toHaveBeenCalled()
    m(prisma.mission.findUnique).mockResolvedValue({ ...vouch, isActive: false })
    await expect(updateMission(7, { isActive: true }, ADMIN)).resolves.toEqual({ changed: ['isActive'] })
    // Already inactive and staying inactive is a no-op, not an error.
    await expect(updateMission(7, { isActive: false }, ADMIN)).resolves.toEqual({ changed: [] })
  })

  it('409 when another admin changed the field since it was read, and writes nothing', async () => {
    m(prisma.mission.findUnique).mockResolvedValueOnce(vouch).mockResolvedValueOnce({ ...vouch, title: 'Someone else' })
    await expect(updateMission(7, { title: 'Mine' }, ADMIN)).rejects.toMatchObject({ status: 409 })
    expect(prisma.mission.updateMany).not.toHaveBeenCalled()
    expect(prisma.appSettingChange.create).not.toHaveBeenCalled()
  })

  it('409 when the guarded update matches no row', async () => {
    m(prisma.mission.updateMany).mockResolvedValue({ count: 0 })
    await expect(updateMission(7, { title: 'Mine' }, ADMIN)).rejects.toMatchObject({ status: 409 })
  })

  it('an unchanged value writes nothing', async () => {
    const r = await updateMission(7, { title: vouch.title, isActive: true }, ADMIN)
    expect(r.changed).toEqual([])
    expect(prisma.mission.updateMany).not.toHaveBeenCalled()
  })

  it('rejects bad titles, bad flags, params on a manual mission, and unknown missions', async () => {
    await expect(updateMission(7, { title: '  ' }, ADMIN)).rejects.toMatchObject({ status: 400 })
    await expect(updateMission(7, { title: 'x'.repeat(121) }, ADMIN)).rejects.toMatchObject({ status: 400 })
    await expect(updateMission(7, { isActive: 'yes' }, ADMIN)).rejects.toMatchObject({ status: 400 })
    m(prisma.mission.findUnique).mockResolvedValue({ ...vouch, verifierKey: null, verifierParams: null })
    await expect(updateMission(7, { verifierParams: { min: 1 } }, ADMIN)).rejects.toMatchObject({ status: 400 })
    m(prisma.mission.findUnique).mockResolvedValue(null)
    await expect(updateMission(99, { title: 'x' }, ADMIN)).rejects.toMatchObject({ status: 404 })
  })

  it('never touches verifierKey, proofKind, level or index, even if passed', async () => {
    await updateMission(7, { title: 'ok', verifierKey: 'x_linked', proofKind: 'URL', level: 1, index: 0 } as never, ADMIN)
    const data = m(prisma.mission.updateMany).mock.calls[0][0].data
    expect(Object.keys(data)).toEqual(['title'])
  })
})

describe('updateLevel', () => {
  const rows = [{ id: 1, reward: 6942, levelTitle: 'T' }, { id: 2, reward: 6942, levelTitle: 'T' }, { id: 3, reward: 6942, levelTitle: 'T' }]
  beforeEach(() => m(prisma.mission.findMany).mockResolvedValue(rows))

  it('a reward change needs confirmation (going forward only) and is written to every row of the level', async () => {
    const err = await updateLevel(6, { reward: 6000 }, ADMIN).catch((e) => e)
    expect(err).toMatchObject({ status: 409 })
    expect(err.needsConfirm).toMatch(/completed from now on.*not topped up or clawed back/)
    expect(prisma.mission.updateMany).not.toHaveBeenCalled()

    const r = await updateLevel(6, { reward: 6000 }, ADMIN, { confirm: true })
    expect(r.changed).toEqual(['reward'])
    expect(prisma.mission.updateMany).toHaveBeenCalledWith({ where: { level: 6, id: { in: [1, 2, 3] } }, data: { reward: 6000 } })
    expect(prisma.appSettingChange.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ key: 'missionLevel:6:reward', oldValue: 6942, newValue: 6000, changedBy: ADMIN }),
    })
    expect(clearMissionCaches).toHaveBeenCalled()
  })

  it('a reward may go anywhere at or below the code value, never above it', async () => {
    await expect(updateLevel(6, { reward: 6943 }, ADMIN, { confirm: true })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/above 6942.*PR/) })
    await expect(updateLevel(6, { reward: 6942 }, ADMIN, { confirm: true })).resolves.toEqual({ changed: [] })
    // A typo can be undone: from a lowered reward back up to the code value.
    m(prisma.mission.findMany).mockResolvedValue(rows.map((x) => ({ ...x, reward: 100 })))
    const err = await updateLevel(6, { reward: 6942 }, ADMIN).catch((e) => e)
    expect(err.needsConfirm).toMatch(/100 -> 6942/)
    await expect(updateLevel(6, { reward: 6942 }, ADMIN, { confirm: true })).resolves.toEqual({ changed: ['reward'] })
  })

  it('both reads are ordered by id so the concurrency compare is stable', async () => {
    await updateLevel(6, { levelTitle: 'X' }, ADMIN)
    for (const call of m(prisma.mission.findMany).mock.calls) expect(call[0].orderBy).toEqual({ id: 'asc' })
    expect(m(prisma.mission.findMany).mock.calls.length).toBe(2)
  })

  it('409 when the level changed since it was read', async () => {
    m(prisma.mission.findMany).mockResolvedValueOnce(rows).mockResolvedValueOnce(rows.map((x) => ({ ...x, reward: 5000 })))
    await expect(updateLevel(6, { reward: 6000 }, ADMIN, { confirm: true })).rejects.toMatchObject({ status: 409 })
    expect(prisma.mission.updateMany).not.toHaveBeenCalled()
  })

  it('bounds the reward and the level title', async () => {
    for (const reward of [0, -5, 1.5, 1_000_001, '7000']) await expect(updateLevel(6, { reward }, ADMIN, { confirm: true })).rejects.toMatchObject({ status: 400 })
    await expect(updateLevel(6, { levelTitle: 'x'.repeat(61) }, ADMIN)).rejects.toMatchObject({ status: 400 })
    expect(prisma.mission.updateMany).not.toHaveBeenCalled()
  })

  it('a title change needs no confirmation', async () => {
    await expect(updateLevel(6, { levelTitle: 'New' }, ADMIN)).resolves.toEqual({ changed: ['levelTitle'] })
    expect(prisma.mission.updateMany).toHaveBeenCalledWith({ where: { level: 6, id: { in: [1, 2, 3] } }, data: { levelTitle: 'New' } })
  })

  it('an unknown level is a 404', async () => {
    m(prisma.mission.findMany).mockResolvedValue([])
    await expect(updateLevel(42, { reward: 5 }, ADMIN)).rejects.toMatchObject({ status: 404 })
  })
})
