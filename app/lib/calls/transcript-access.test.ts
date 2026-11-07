// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/missions', () => ({ getCurrentLevel: vi.fn() }))
vi.mock('@/app/lib/mission-review-access', () => ({ isDreadPizzaRoberts: vi.fn() }))
vi.mock('@/app/lib/settings', () => ({ getSetting: vi.fn() }))

import { getCurrentLevel } from '@/app/lib/missions'
import { isDreadPizzaRoberts } from '@/app/lib/mission-review-access'
import { getSetting } from '@/app/lib/settings'
import { CALL_TRANSCRIPT_MIN_LEVEL, callSectionAccess, canViewCallTranscript } from './transcript-access'

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

describe('callSectionAccess', () => {
  const defaults: Record<string, number> = {
    'calls.transcriptMinLevel': 6,
    'calls.summaryMinLevel': 5,
    'calls.actionItemsMinLevel': 4,
    'calls.chaptersMinLevel': 3,
  }
  const vis = async (id = 'u') => {
    const a = await callSectionAccess(id)
    return [a.chapters.visible, a.actionItems.visible, a.summary.visible, a.transcript.visible]
  }
  beforeEach(() => {
    vi.resetAllMocks()
    dpr.mockResolvedValue(false)
    setting.mockImplementation((async (k: string) => defaults[k]) as never)
  })

  it('gates each section at its own level', async () => {
    level.mockResolvedValue(2)
    expect(await vis()).toEqual([false, false, false, false])
    level.mockResolvedValue(3)
    expect(await vis()).toEqual([true, false, false, false])
    level.mockResolvedValue(4)
    expect(await vis()).toEqual([true, true, false, false])
    level.mockResolvedValue(5)
    expect(await vis()).toEqual([true, true, true, false])
    level.mockResolvedValue(6)
    expect(await vis()).toEqual([true, true, true, true])
  })
  it('reports the level each section needs', async () => {
    level.mockResolvedValue(1)
    const a = await callSectionAccess('u')
    expect([a.chapters.minLevel, a.actionItems.minLevel, a.summary.minLevel, a.transcript.minLevel]).toEqual([3, 4, 5, 6])
  })
  it('follows the settings', async () => {
    defaults['calls.summaryMinLevel'] = 2
    level.mockResolvedValue(2)
    expect((await callSectionAccess('u')).summary.visible).toBe(true)
    defaults['calls.summaryMinLevel'] = 5
  })
  it('lets Dread Pizza Roberts see everything at a low level', async () => {
    level.mockResolvedValue(1)
    dpr.mockResolvedValue(true)
    expect(await vis()).toEqual([true, true, true, true])
  })
  it('skips the role lookup when the level already shows everything', async () => {
    level.mockResolvedValue(9)
    await vis()
    expect(dpr).not.toHaveBeenCalled()
    expect(level).toHaveBeenCalledTimes(1)
  })
  it('looks up the level once and the role at most once', async () => {
    level.mockResolvedValue(1)
    await vis()
    expect(level).toHaveBeenCalledTimes(1)
    expect(dpr).toHaveBeenCalledTimes(1)
  })
  it('fails closed when the level lookup throws', async () => {
    level.mockRejectedValue(new Error('db'))
    expect(await vis()).toEqual([false, false, false, false])
  })
  it('fails closed when both lookups throw', async () => {
    level.mockRejectedValue(new Error('db'))
    dpr.mockRejectedValue(new Error('discord'))
    expect(await vis()).toEqual([false, false, false, false])
  })
  it('hides a section whose setting cannot be read, even from a top level member', async () => {
    setting.mockImplementation((async (k: string) => {
      if (k === 'calls.summaryMinLevel') throw new Error('db')
      return defaults[k]
    }) as never)
    level.mockResolvedValue(9)
    expect(await vis()).toEqual([true, true, false, true])
  })
  it('shows nothing for an empty id', async () => {
    expect(await vis('')).toEqual([false, false, false, false])
    expect(level).not.toHaveBeenCalled()
  })
})
