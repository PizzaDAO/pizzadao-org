import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSession, canManageCrew } = vi.hoisted(() => ({ getSession: vi.fn(), canManageCrew: vi.fn() }))
vi.mock('@/app/lib/session', () => ({ getSession }))
vi.mock('@/app/lib/crew-leads', () => ({ canManageCrew }))

import { requireEducationManager } from './access'

beforeEach(() => vi.clearAllMocks())

describe('requireEducationManager', () => {
  it('401 without a session', async () => {
    getSession.mockResolvedValue(null)
    await expect(requireEducationManager('education')).rejects.toMatchObject({ statusCode: 401 })
  })
  it('403 for a non-lead', async () => {
    getSession.mockResolvedValue({ discordId: 'u1' })
    canManageCrew.mockResolvedValue(false)
    await expect(requireEducationManager('education')).rejects.toMatchObject({ statusCode: 403 })
    expect(canManageCrew).toHaveBeenCalledWith('u1', 'education')
  })
  it('404 for any other crew, before any lookup', async () => {
    await expect(requireEducationManager('design')).rejects.toMatchObject({ statusCode: 404 })
    expect(getSession).not.toHaveBeenCalled()
  })
  it('returns the id for a lead or admin (canManageCrew covers both)', async () => {
    getSession.mockResolvedValue({ discordId: 'u1' })
    canManageCrew.mockResolvedValue(true)
    await expect(requireEducationManager('Education')).resolves.toBe('u1')
  })
})
