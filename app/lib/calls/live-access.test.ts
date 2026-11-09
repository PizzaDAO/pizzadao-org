// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/lib/discord', () => ({ getUserRoles: vi.fn() }))
vi.mock('@/app/lib/mission-review-access', () => ({ isDreadPizzaRoberts: vi.fn() }))
vi.mock('@/app/lib/settings', () => ({ getSetting: vi.fn() }))
vi.mock('./transcript-access', () => ({ callSectionAccess: vi.fn() }))

import { getUserRoles } from '@/app/lib/discord'
import { isDreadPizzaRoberts } from '@/app/lib/mission-review-access'
import { getSetting } from '@/app/lib/settings'
import { callSectionAccess } from './transcript-access'
import { clearLiveAccessCache, liveAccess, LIVE_ACCESS_CACHE_MS, parseRoleLines } from './live-access'

const roles = vi.mocked(getUserRoles)
const dpr = vi.mocked(isDreadPizzaRoberts)
const sections = vi.mocked(callSectionAccess)
const setting = vi.mocked(getSetting)
const HOST_ROLE = '800000000000000001'

beforeEach(() => {
  vi.resetAllMocks()
  clearLiveAccessCache()
  roles.mockResolvedValue([])
  dpr.mockResolvedValue(false)
  setting.mockResolvedValue('' as never)
  sections.mockResolvedValue({ actionItems: { visible: true, minLevel: 4 } } as never)
})

describe('liveAccess', () => {
  it('follows calls.actionItemsMinLevel through the published-call gate', async () => {
    sections.mockResolvedValue({ actionItems: { visible: false, minLevel: 4 } } as never)
    expect((await liveAccess('u1')).actionItems).toEqual({ visible: false, minLevel: 4 })
  })
  it('fails closed on any lookup failure', async () => {
    sections.mockRejectedValue(new Error('x'))
    roles.mockRejectedValue(new Error('x'))
    expect(await liveAccess('u1')).toEqual({ actionItems: { visible: false, minLevel: 10 }, host: false })
  })
  it('no signed-in member id means closed', async () => {
    expect((await liveAccess('')).host).toBe(false)
    expect(sections).not.toHaveBeenCalled()
  })
  it('hosts: Dread Pizza Roberts, or a role in calls.liveHostRoleIds; the call starter is not automatic', async () => {
    expect((await liveAccess('plain')).host).toBe(false)
    clearLiveAccessCache()
    dpr.mockResolvedValue(true)
    expect((await liveAccess('dpr')).host).toBe(true)
    clearLiveAccessCache()
    dpr.mockResolvedValue(false)
    roles.mockResolvedValue([HOST_ROLE])
    expect((await liveAccess('r1')).host).toBe(false) // role not configured
    clearLiveAccessCache()
    setting.mockResolvedValue(`junk\n${HOST_ROLE}\n` as never)
    expect((await liveAccess('r2')).host).toBe(true)
  })
  it('caches for 60 seconds per member', async () => {
    await liveAccess('u1', 1_000)
    await liveAccess('u1', 1_000 + LIVE_ACCESS_CACHE_MS - 1)
    expect(sections).toHaveBeenCalledTimes(1)
    expect(roles).toHaveBeenCalledTimes(1)
    await liveAccess('u1', 1_000 + LIVE_ACCESS_CACHE_MS)
    expect(sections).toHaveBeenCalledTimes(2)
    await liveAccess('u2', 1_000)
    expect(sections).toHaveBeenCalledTimes(3)
  })
})

describe('parseRoleLines', () => {
  it('keeps numeric ids only', () => {
    expect(parseRoleLines(`${HOST_ROLE}\n abc \n12\n 800000000000000002 `)).toEqual([HOST_ROLE, '800000000000000002'])
  })
})
