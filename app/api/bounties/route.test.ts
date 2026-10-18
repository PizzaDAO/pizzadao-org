// @vitest-environment node
// jalapeno-82565 v2 — submission details are only returned to poster, claimer, crew leads/admins.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const getSession = vi.fn()
const canManageCrew = vi.fn()
const canManageBounty = vi.fn()
vi.mock('@/app/lib/session', () => ({ getSession: () => getSession() }))
vi.mock('@/app/lib/crew-leads', () => ({
  canManageCrew: (...a: unknown[]) => canManageCrew(...a),
  canManageBounty: (...a: unknown[]) => canManageBounty(...a),
}))
vi.mock('@/app/lib/economy', () => ({ requireOnboarded: vi.fn() }))
vi.mock('@/app/lib/discord-mention-resolve', () => ({
  resolveDiscordMentions: vi.fn().mockResolvedValue({ channels: {}, roles: {}, guildId: null }),
}))
vi.mock('@/app/lib/bounties', () => ({
  getAllBounties: vi.fn(),
  createBounty: vi.fn(),
  resolveBountyCrewId: vi.fn(),
  getCrewLabelMap: vi.fn().mockResolvedValue(new Map()),
}))

import { getAllBounties } from '@/app/lib/bounties'
import { GET } from './route'

const row = {
  id: 1, description: 'd', link: null, reward: 5, createdBy: 'poster', claimedBy: 'claimer', status: 'SUBMITTED',
  crewId: 'ops', createdAt: new Date(), submittedAt: new Date(), submissionNote: 'secret note',
  submissionLink: 'https://x.test', reviewNote: 'secret review', _count: { comments: 0 },
}
const get = async () => {
  const res = await GET(new NextRequest('http://localhost/api/bounties?crewId=ops'))
  return (await res.json()).bounties[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getAllBounties as ReturnType<typeof vi.fn>).mockResolvedValue([row])
  canManageCrew.mockResolvedValue(false)
  canManageBounty.mockResolvedValue(false)
})

describe('GET /api/bounties submission visibility', () => {
  it.each(['poster', 'claimer'])('%s sees the submission', async (id) => {
    getSession.mockResolvedValue({ discordId: id })
    expect(await get()).toMatchObject({ submissionNote: 'secret note', submissionLink: 'https://x.test', reviewNote: 'secret review' })
  })

  it('a crew lead / admin sees it', async () => {
    getSession.mockResolvedValue({ discordId: 'lead' })
    canManageCrew.mockResolvedValue(true)
    expect(await get()).toMatchObject({ submissionNote: 'secret note' })
  })

  it('strangers and signed-out visitors get nulls (but still see the status)', async () => {
    getSession.mockResolvedValue({ discordId: 'stranger' })
    expect(await get()).toMatchObject({ status: 'SUBMITTED', submissionNote: null, submissionLink: null, reviewNote: null })
    getSession.mockResolvedValue(null)
    expect(await get()).toMatchObject({ submissionNote: null, submissionLink: null, reviewNote: null })
  })
})
