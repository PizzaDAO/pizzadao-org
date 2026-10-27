// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/missions', () => ({ getCurrentLevel: vi.fn() }))
vi.mock('@/app/lib/mission-review-access', () => ({ DPR_ONLY_MIN_LEVEL: 8, canReviewMission: vi.fn() }))

import { getCurrentLevel } from '@/app/lib/missions'
import { canReviewMission } from '@/app/lib/mission-review-access'
import { CALL_TRANSCRIPT_MIN_LEVEL, canViewCallTranscript } from './transcript-access'

const level = vi.mocked(getCurrentLevel)
const dpr = vi.mocked(canReviewMission)

describe('canViewCallTranscript', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    dpr.mockResolvedValue(false)
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
