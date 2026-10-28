// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/db')
vi.mock('@/app/lib/mission-cache', () => ({ clearMissionCaches: vi.fn() }))

import { prisma } from '@/app/lib/db'
import { clearMissionCaches } from '@/app/lib/mission-cache'
import { clearSettingsCache } from '@/app/lib/settings'
import { MissionEditError, updateLevel, updateMission, validateVerifierParams } from './admin-missions'

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
    const r = await updateMission(7, { verifierParams: { min: 6, sources: ['PIZZADAO'] } }, ADMIN)
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

  it('lowering a count needs confirmation, with copy built from the human-release setting', async () => {
    const err = await updateMission(7, { verifierParams: { min: 2, sources: ['PIZZADAO'] } }, ADMIN).catch((e) => e)
    expect(err).toMatchObject({ status: 409 })
    expect(err.needsConfirm).toMatch(/pass on their next check.*Level 6 passes still wait.*from Level 6/)
    expect(prisma.mission.updateMany).not.toHaveBeenCalled()
    const ok = await updateMission(7, { verifierParams: { min: 2, sources: ['PIZZADAO'] } }, ADMIN, { confirm: true })
    expect(ok.changed).toEqual(['verifierParams'])
  })

  it('raising a count needs no confirmation', async () => {
    await expect(updateMission(7, { verifierParams: { min: 9, sources: ['PIZZADAO'] } }, ADMIN)).resolves.toMatchObject({ changed: ['verifierParams'] })
  })

  it('edits title, description and the active flag, one audit row per changed field', async () => {
    const r = await updateMission(7, { title: ' New title ', description: null, isActive: false }, ADMIN)
    expect(r.changed.sort()).toEqual(['description', 'isActive', 'title'])
    expect(prisma.mission.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { title: 'New title', description: null, isActive: false } }))
    expect(prisma.appSettingChange.create).toHaveBeenCalledTimes(3)
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
    const err = await updateLevel(6, { reward: 7000 }, ADMIN).catch((e) => e)
    expect(err).toMatchObject({ status: 409 })
    expect(err.needsConfirm).toMatch(/completed from now on.*not topped up or clawed back/)
    expect(prisma.mission.updateMany).not.toHaveBeenCalled()

    const r = await updateLevel(6, { reward: 7000 }, ADMIN, { confirm: true })
    expect(r.changed).toEqual(['reward'])
    expect(prisma.mission.updateMany).toHaveBeenCalledWith({ where: { level: 6 }, data: { reward: 7000 } })
    expect(prisma.appSettingChange.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ key: 'missionLevel:6:reward', oldValue: 6942, newValue: 7000, changedBy: ADMIN }),
    })
    expect(clearMissionCaches).toHaveBeenCalled()
  })

  it('bounds the reward and the level title', async () => {
    for (const reward of [0, -5, 1.5, 1_000_001, '7000']) await expect(updateLevel(6, { reward }, ADMIN, { confirm: true })).rejects.toMatchObject({ status: 400 })
    await expect(updateLevel(6, { levelTitle: 'x'.repeat(61) }, ADMIN)).rejects.toMatchObject({ status: 400 })
    expect(prisma.mission.updateMany).not.toHaveBeenCalled()
  })

  it('a title change needs no confirmation', async () => {
    await expect(updateLevel(6, { levelTitle: 'New' }, ADMIN)).resolves.toEqual({ changed: ['levelTitle'] })
    expect(prisma.mission.updateMany).toHaveBeenCalledWith({ where: { level: 6 }, data: { levelTitle: 'New' } })
  })

  it('an unknown level is a 404', async () => {
    m(prisma.mission.findMany).mockResolvedValue([])
    await expect(updateLevel(42, { reward: 5 }, ADMIN)).rejects.toMatchObject({ status: 404 })
  })
})
