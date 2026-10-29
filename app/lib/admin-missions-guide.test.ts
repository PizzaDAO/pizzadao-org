// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/db')
vi.mock('@/app/lib/mission-cache', () => ({ clearMissionCaches: vi.fn() }))

import { prisma } from '@/app/lib/db'
import { clearMissionCaches } from '@/app/lib/mission-cache'
import { clearSettingsCache } from '@/app/lib/settings'
import { updateMission } from './admin-missions'

const m = (f: unknown) => f as ReturnType<typeof vi.fn>
const ADMIN = '400000000000000001'

const vouch = { id: 7, level: 6, index: 2, title: 'Get vouched by 5 members', description: 'd', isActive: true, verifierKey: 'vouch_received', verifierParams: { min: 5, sources: ['PIZZADAO'] }, reward: 6942, levelTitle: 'T', guideHref: null }

beforeEach(() => {
  vi.clearAllMocks()
  clearSettingsCache({ all: true })
  m(prisma.appSetting.findMany).mockResolvedValue([])
  m(prisma.mission.findUnique).mockResolvedValue(vouch)
  m(prisma.mission.updateMany).mockResolvedValue({ count: 1 })
})

describe('updateMission guideHref (the "how to do this" handbook link)', () => {
  it('saves an internal handbook path, audited as mission:<id>:guideHref', async () => {
    const r = await updateMission(7, { guideHref: ' /handbook/levels#vouching ' }, ADMIN)
    expect(r.changed).toEqual(['guideHref'])
    expect(prisma.mission.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { guideHref: '/handbook/levels#vouching' } }))
    expect(prisma.appSettingChange.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ key: 'mission:7:guideHref', newValue: '/handbook/levels#vouching', changedBy: ADMIN }),
    })
    expect(clearMissionCaches).toHaveBeenCalled()
  })

  it('empty or null clears the link', async () => {
    m(prisma.mission.findUnique).mockResolvedValue({ ...vouch, guideHref: '/handbook/levels' })
    await expect(updateMission(7, { guideHref: '' }, ADMIN)).resolves.toEqual({ changed: ['guideHref'] })
    expect(prisma.mission.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { guideHref: null } }))
  })

  it('rejects external URLs, javascript:, protocol-relative, unknown roots, unknown handbook pages and junk', async () => {
    for (const bad of [
      'https://example.org/x',
      'http://example.org',
      'javascript:alert(1)',
      '//example.org/handbook',
      '/admin/settings',
      '/handbook/levels#Bad Anchor',
      '/handbook/levels/../../x',
      '/handbook/nope-not-a-page',
      'handbook/levels',
      '/handbook/' + 'a'.repeat(130),
      5,
    ]) {
      await expect(updateMission(7, { guideHref: bad }, ADMIN), String(bad)).rejects.toMatchObject({ status: 400 })
    }
    expect(prisma.mission.updateMany).not.toHaveBeenCalled()
    expect(prisma.appSettingChange.create).not.toHaveBeenCalled()
  })

  it('an unchanged link writes nothing', async () => {
    m(prisma.mission.findUnique).mockResolvedValue({ ...vouch, guideHref: '/handbook/levels' })
    await expect(updateMission(7, { guideHref: '/handbook/levels' }, ADMIN)).resolves.toEqual({ changed: [] })
    expect(prisma.mission.updateMany).not.toHaveBeenCalled()
  })
})
