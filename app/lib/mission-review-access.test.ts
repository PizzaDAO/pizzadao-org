// Mission reviewer authorization (plans/mission-verification.md §5.1, D10).
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./db', () => ({ prisma: { appSetting: { findMany: vi.fn(async () => []) } } }))
vi.mock('./discord', () => ({ getUserRoles: vi.fn() }))

import { canReviewMission, canReviewAnyMission, isDreadPizzaRoberts, missionReviewScope, missionReviewerRoleIds } from './mission-review-access'
import { clearSettingsCache } from './settings'
import { prisma } from './db'
import { getUserRoles } from './discord'
import { ADMIN_ROLE_IDS, MISSION_REVIEWER_ROLE_IDS } from '@/app/ui/constants'

const LEONARDO = ADMIN_ROLE_IDS[0]
const DPR = '812131585327235113'
const CAPO = '839206162837798945'
const PEP_MAFIA = '823266914834841610'
const RANDOM = '999999999999999999'

const roles = vi.mocked(getUserRoles)

beforeEach(() => {
  vi.clearAllMocks()
  clearSettingsCache({ all: true })
  vi.mocked(prisma.appSetting.findMany).mockResolvedValue([] as never)
})

const setDprOnlyLevel = (value: unknown) => vi.mocked(prisma.appSetting.findMany).mockResolvedValue([{ key: 'missions.dprOnlyMinLevel', value }] as never)

describe('isDreadPizzaRoberts (pinned to the role id)', () => {
  it('is true only for the DPR role', async () => {
    await expect(isDreadPizzaRoberts([DPR])).resolves.toBe(true)
    for (const r of [LEONARDO, CAPO, PEP_MAFIA, RANDOM]) await expect(isDreadPizzaRoberts([r])).resolves.toBe(false)
    await expect(isDreadPizzaRoberts([])).resolves.toBe(false)
  })
  it('by Discord id, and fails closed when the role lookup throws', async () => {
    roles.mockResolvedValue([DPR])
    await expect(isDreadPizzaRoberts('u1')).resolves.toBe(true)
    roles.mockRejectedValue(new Error('discord down'))
    await expect(isDreadPizzaRoberts('u1')).resolves.toBe(false)
  })
  it('does not move when the mission DPR-only level setting is edited', async () => {
    setDprOnlyLevel(5)
    await expect(isDreadPizzaRoberts([DPR])).resolves.toBe(true)
    await expect(isDreadPizzaRoberts([CAPO])).resolves.toBe(false)
    await expect(isDreadPizzaRoberts([LEONARDO])).resolves.toBe(false)
  })
})

describe('the DPR-only level follows the missions.dprOnlyMinLevel setting', () => {
  it('lowered to 5: L5-L7 become DPR-only, L4 is unchanged', async () => {
    setDprOnlyLevel(5)
    await expect(canReviewMission([CAPO], 4)).resolves.toBe(true)
    for (const level of [5, 6, 7, 8]) {
      await expect(canReviewMission([CAPO], level)).resolves.toBe(false)
      await expect(canReviewMission([DPR], level)).resolves.toBe(true)
    }
    const scope = await missionReviewScope([CAPO])
    expect(scope?.(4)).toBe(true)
    expect(scope?.(5)).toBe(false)
  })
  it('an invalid stored value fails to the strictest (DPR-only from level 1)', async () => {
    setDprOnlyLevel(9) // loosening is not allowed
    await expect(canReviewMission([CAPO], 1)).resolves.toBe(false)
    await expect(canReviewMission([DPR], 1)).resolves.toBe(true)
  })
  it('settings unreadable: strictest as well', async () => {
    vi.mocked(prisma.appSetting.findMany).mockRejectedValue(new Error('db down'))
    await expect(canReviewMission([LEONARDO], 2)).resolves.toBe(false)
    await expect(canReviewMission([DPR], 2)).resolves.toBe(true)
  })
})

describe('canReviewMission (by role list)', () => {
  it.each([
    ['Leonardo (admin)', LEONARDO],
    ['Dread Pizza Roberts', DPR],
    ['Pizza Capo', CAPO],
    ['Pepperoni Mafia', PEP_MAFIA],
  ])('%s may review L1–L7', async (_name, role) => {
    for (let level = 1; level <= 7; level++) {
      await expect(canReviewMission([role], level)).resolves.toBe(true)
    }
  })

  it('only Dread Pizza Roberts may review L8', async () => {
    await expect(canReviewMission([DPR], 8)).resolves.toBe(true)
    for (const role of [LEONARDO, CAPO, PEP_MAFIA]) {
      await expect(canReviewMission([role], 8)).resolves.toBe(false)
    }
  })

  it('nobody else, and no invalid levels', async () => {
    await expect(canReviewMission([RANDOM], 1)).resolves.toBe(false)
    await expect(canReviewMission([], 1)).resolves.toBe(false)
    await expect(canReviewMission([DPR], 0)).resolves.toBe(false)
    await expect(canReviewMission([DPR], 1.5)).resolves.toBe(false)
  })

  it('the L1–L7 set is the admin roles plus every pinged reviewer role', () => {
    expect([...missionReviewerRoleIds(3)].sort()).toEqual([...new Set([...ADMIN_ROLE_IDS, ...MISSION_REVIEWER_ROLE_IDS])].sort())
    expect(missionReviewerRoleIds(8)).toEqual([DPR])
  })
})

describe('canReviewMission (by Discord id)', () => {
  it('looks the roles up via the bot', async () => {
    roles.mockResolvedValue([CAPO])
    await expect(canReviewMission('u1', 4)).resolves.toBe(true)
    expect(roles).toHaveBeenCalledWith('u1')
  })

  it('fails closed when the lookup throws', async () => {
    roles.mockRejectedValue(new Error('discord down'))
    await expect(canReviewMission('u1', 4)).resolves.toBe(false)
  })
})

describe('missionReviewScope / canReviewAnyMission', () => {
  it('Pizza Capo sees L1–L7 but not L8', async () => {
    const scope = await missionReviewScope([CAPO])
    expect(scope).not.toBeNull()
    expect(scope!(1)).toBe(true)
    expect(scope!(7)).toBe(true)
    expect(scope!(8)).toBe(false)
  })

  it('Dread Pizza Roberts sees every level', async () => {
    const scope = await missionReviewScope([DPR])
    expect([1, 5, 7, 8].map((l) => scope!(l))).toEqual([true, true, true, true])
  })

  it('a non-reviewer gets null / false', async () => {
    await expect(missionReviewScope([RANDOM])).resolves.toBeNull()
    await expect(canReviewAnyMission([RANDOM])).resolves.toBe(false)
    await expect(canReviewAnyMission([PEP_MAFIA])).resolves.toBe(true)
  })
})
