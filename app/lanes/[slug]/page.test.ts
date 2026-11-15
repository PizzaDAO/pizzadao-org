// @vitest-environment node
// Visitors and profile-less sessions are sent to /join with the lane carried along (and returnTo for
// existing members who still need to log in); the setting off or an unpublished lane is a 404.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const redirect = vi.fn((to: string) => {
  throw new Error(`REDIRECT:${to}`)
})
const notFound = vi.fn(() => {
  throw new Error('NOT_FOUND')
})
vi.mock('next/navigation', () => ({ redirect: (to: string) => redirect(to), notFound: () => notFound() }))
const getSession = vi.fn()
vi.mock('@/app/lib/session', () => ({ getSession: () => getSession() }))
const fetchMemberIdByDiscordId = vi.fn()
vi.mock('@/app/lib/sheets/member-repository', () => ({ fetchMemberIdByDiscordId: (...a: unknown[]) => fetchMemberIdByDiscordId(...a) }))
const lanesEnabled = vi.fn()
const getPublishedLane = vi.fn()
vi.mock('@/app/lib/lanes', () => ({
  lanesEnabled: () => lanesEnabled(),
  getPublishedLane: (...a: unknown[]) => getPublishedLane(...a),
  getMemberLane: vi.fn(),
}))
vi.mock('@/app/lib/db', () => ({ prisma: {} }))
vi.mock('@/app/lib/handbook', () => ({ getHandbookFacts: vi.fn(), renderPlaceholders: vi.fn() }))
vi.mock('@/app/lib/i18n/get-locale', () => ({ resolveLocale: vi.fn() }))
vi.mock('next-intl/server', () => ({ getTranslations: vi.fn() }))
vi.mock('@/app/ui/handbook/HandbookMarkdown', () => ({ HandbookMarkdown: () => null }))
vi.mock('@/app/ui/shared/Editorial', () => ({ EditorialMasthead: () => null, EditorialPage: () => null, paperCard: '', pillOutline: '', pillTomato: '' }))
vi.mock('@/app/ui/lanes/LaneClient', () => ({ LaneStepItem: () => null, PinButton: () => null, PinOnArrive: () => null }))

import LanePage from './page'

const render = (slug: string, pick?: string) => LanePage({ params: Promise.resolve({ slug }), searchParams: Promise.resolve({ pick }) })
const JOIN = '/join?lane=host&returnTo=%2Flanes%2Fhost%3Fpick%3D1'

beforeEach(() => {
  vi.clearAllMocks()
  lanesEnabled.mockResolvedValue(true)
  getPublishedLane.mockResolvedValue({ slug: 'host', tag: 'Host', title: 'Host', summary: '', missionId: null, stretchMissionIds: [], crewId: null, position: 1, steps: [] })
  getSession.mockResolvedValue(null)
  fetchMemberIdByDiscordId.mockResolvedValue(null)
})

describe('/lanes/[slug] for visitors', () => {
  it('sends a visitor to /join with the lane and a returnTo back to the guide', async () => {
    await expect(render('host', '1')).rejects.toThrow(`REDIRECT:${JOIN}`)
  })

  it('does the same for a session without a member profile', async () => {
    getSession.mockResolvedValue({ discordId: '500000000000000077' })
    await expect(render('host')).rejects.toThrow(`REDIRECT:${JOIN}`)
  })

  it('404s (no redirect, no lane carried) while the setting is off, for an unpublished lane or a bad slug', async () => {
    lanesEnabled.mockResolvedValue(false)
    await expect(render('host')).rejects.toThrow('NOT_FOUND')
    lanesEnabled.mockResolvedValue(true)
    getPublishedLane.mockResolvedValue(null)
    await expect(render('host')).rejects.toThrow('NOT_FOUND')
    await expect(render('../x')).rejects.toThrow('NOT_FOUND')
    expect(redirect).not.toHaveBeenCalled()
  })
})
