// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/missions', () => ({ getCurrentLevel: vi.fn() }))
vi.mock('@/app/lib/mission-review-access', () => ({ isDreadPizzaRoberts: vi.fn() }))
vi.mock('@/app/lib/settings', () => ({ getSetting: vi.fn() }))

import { getCurrentLevel } from '@/app/lib/missions'
import { isDreadPizzaRoberts } from '@/app/lib/mission-review-access'
import { getSetting } from '@/app/lib/settings'
import { CALL_TRANSCRIPT_MIN_LEVEL, canViewCallTranscript } from './transcript-access'

const level = vi.mocked(getCurrentLevel)
const dpr = vi.mocked(isDreadPizzaRoberts)
const setting = vi.mocked(getSetting)

describe('canViewCallTranscript', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    dpr.mockResolvedValue(false)
    setting.mockResolvedValue(CALL_TRANSCRIPT_MIN_LEVEL as never)
  })

  it('reads the calls.transcriptMinLevel setting', async () => {
    level.mockResolvedValue(6)
    await canViewCallTranscript('u')
    expect(setting).toHaveBeenCalledWith('calls.transcriptMinLevel')
  })
  it('follows the setting: lowered to 4 lets a level 4 member read', async () => {
    setting.mockResolvedValue(4 as never)
    level.mockResolvedValue(4)
    expect(await canViewCallTranscript('u')).toBe(true)
    level.mockResolvedValue(3)
    expect(await canViewCallTranscript('u')).toBe(false)
  })
  it('follows the setting: raised to 9 shuts out a level 8 member but not the review role', async () => {
    setting.mockResolvedValue(9 as never)
    level.mockResolvedValue(8)
    expect(await canViewCallTranscript('u')).toBe(false)
    dpr.mockResolvedValue(true)
    expect(await canViewCallTranscript('u')).toBe(true)
  })

  it('requires level 6', () => expect(CALL_TRANSCRIPT_MIN_LEVEL).toBe(6))
  it('denies level 5', async () => {
    level.mockResolvedValue(5)
    expect(await canViewCallTranscript('u')).toBe(false)
  })
  it('allows level 6', async () => {
    level.mockResolvedValue(6)
    expect(await canViewCallTranscript('u')).toBe(true)
  })
  it('allows DPR at a low level', async () => {
    level.mockResolvedValue(1)
    dpr.mockResolvedValue(true)
    expect(await canViewCallTranscript('u')).toBe(true)
  })
  it('denies when the level lookup throws', async () => {
    level.mockRejectedValue(new Error('db'))
    expect(await canViewCallTranscript('u')).toBe(false)
  })
  it('denies when both lookups throw', async () => {
    level.mockRejectedValue(new Error('db'))
    dpr.mockRejectedValue(new Error('discord'))
    expect(await canViewCallTranscript('u')).toBe(false)
  })
  it('still allows level 6 if the DPR lookup throws', async () => {
    level.mockResolvedValue(6)
    dpr.mockRejectedValue(new Error('discord'))
    expect(await canViewCallTranscript('u')).toBe(true)
  })
  it('denies an empty id', async () => {
    expect(await canViewCallTranscript('')).toBe(false)
  })
})
