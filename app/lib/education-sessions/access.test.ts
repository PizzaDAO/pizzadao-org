import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSession, canManageCrew, getSetting } = vi.hoisted(() => ({ getSession: vi.fn(), canManageCrew: vi.fn(), getSetting: vi.fn() }))
vi.mock('@/app/lib/session', () => ({ getSession }))
vi.mock('@/app/lib/crew-leads', () => ({ canManageCrew }))
vi.mock('@/app/lib/settings', () => ({ getSetting }))

import { requireSessionManager, sessionManagerOrNull } from './access'

beforeEach(() => {
  vi.clearAllMocks()
  getSetting.mockResolvedValue(['education'])
})

describe('requireSessionManager', () => {
  it('401 without a session', async () => {
    getSession.mockResolvedValue(null)
    await expect(requireSessionManager('education')).rejects.toMatchObject({ statusCode: 401 })
  })
  it('403 for a member who is not a lead (cannot schedule, edit or cancel)', async () => {
    getSession.mockResolvedValue({ discordId: 'u1' })
    canManageCrew.mockResolvedValue(false)
    await expect(requireSessionManager('education')).rejects.toMatchObject({ statusCode: 403 })
    expect(canManageCrew).toHaveBeenCalledWith('u1', 'education')
  })
  it('404 for a crew that is not in the setting, before any lookup', async () => {
    await expect(requireSessionManager('design')).rejects.toMatchObject({ statusCode: 404 })
    expect(getSession).not.toHaveBeenCalled()
  })
  it('an empty setting means nobody, admins included', async () => {
    getSetting.mockResolvedValue([])
    await expect(requireSessionManager('education')).rejects.toMatchObject({ statusCode: 404 })
  })
  it('an unreadable setting means nobody', async () => {
    getSetting.mockRejectedValue(new Error('db down'))
    await expect(requireSessionManager('education')).rejects.toMatchObject({ statusCode: 404 })
  })
  it('a listed crew other than education works the same way (nothing is hard-coded)', async () => {
    getSetting.mockResolvedValue(['education', 'events'])
    getSession.mockResolvedValue({ discordId: 'u2' })
    canManageCrew.mockResolvedValue(true)
    await expect(requireSessionManager('Events')).resolves.toBe('u2')
    expect(canManageCrew).toHaveBeenCalledWith('u2', 'events')
  })
  it('returns the id for a lead or admin (canManageCrew covers both)', async () => {
    getSession.mockResolvedValue({ discordId: 'u1' })
    canManageCrew.mockResolvedValue(true)
    await expect(requireSessionManager('Education')).resolves.toBe('u1')
  })
})

describe('sessionManagerOrNull', () => {
  it('null instead of throwing', async () => {
    getSession.mockResolvedValue({ discordId: 'u1' })
    canManageCrew.mockResolvedValue(false)
    await expect(sessionManagerOrNull('education')).resolves.toBeNull()
  })
})
