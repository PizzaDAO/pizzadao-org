import { describe, it, expect, vi, beforeEach } from 'vitest'

const getSession = vi.fn()
const hasAnyRole = vi.fn()
const adminAllowed = vi.fn()
vi.mock('./session', () => ({ getSession: () => getSession() }))
vi.mock('@/app/lib/settings/toggles', () => ({ toggleEnabled: (...a: unknown[]) => adminAllowed(...a) }))
vi.mock('./discord', () => ({ hasAnyRole: (...a: unknown[]) => hasAnyRole(...a) }))

import { requireSession, requireAdmin, requireAnyRole, safeEqual, checkSecret } from './auth-guards'
import { ADMIN_ROLE_IDS } from '@/app/ui/constants'

describe('auth guards', () => {
  beforeEach(() => {
    getSession.mockReset()
    hasAnyRole.mockReset()
    adminAllowed.mockReset()
  })

  it('requireSession returns 401 without a session', async () => {
    getSession.mockResolvedValue(null)
    const r = await requireSession()
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.response.status).toBe(401)
  })

  it('requireSession returns the session when present', async () => {
    getSession.mockResolvedValue({ discordId: 'u1', createdAt: Date.now() })
    const r = await requireSession()
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.session.discordId).toBe('u1')
  })

  it('requireAdmin returns 401 without a session and never checks roles', async () => {
    getSession.mockResolvedValue(null)
    const r = await requireAdmin()
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.response.status).toBe(401)
    expect(hasAnyRole).not.toHaveBeenCalled()
  })

  it('requireAdmin returns 403 for non-admins', async () => {
    getSession.mockResolvedValue({ discordId: 'u1', createdAt: Date.now() })
    hasAnyRole.mockResolvedValue(false)
    const r = await requireAdmin()
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.response.status).toBe(403)
    expect(hasAnyRole).toHaveBeenCalledWith('u1', ADMIN_ROLE_IDS)
  })

  it('requireAdmin fails closed when the role lookup throws', async () => {
    getSession.mockResolvedValue({ discordId: 'u1', createdAt: Date.now() })
    hasAnyRole.mockRejectedValue(new Error('discord down'))
    const r = await requireAdmin()
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.response.status).toBe(403)
  })

  it('requireAdmin passes for admins', async () => {
    getSession.mockResolvedValue({ discordId: 'admin', createdAt: Date.now() })
    hasAnyRole.mockResolvedValue(true)
    const r = await requireAdmin()
    expect(r.ok).toBe(true)
  })

  describe('Telegram-started sessions', () => {
    const tgSession = { discordId: 'admin', createdAt: Date.now(), authMethod: 'telegram' as const }

    it('requireAdmin refuses an admin on a Telegram session while the setting is off, without checking roles', async () => {
      getSession.mockResolvedValue(tgSession)
      adminAllowed.mockResolvedValue(false)
      hasAnyRole.mockResolvedValue(true)
      const r = await requireAdmin()
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.response.status).toBe(403)
      expect(hasAnyRole).not.toHaveBeenCalled()
      expect(adminAllowed).toHaveBeenCalledWith('auth.telegramSignInAdminAllowed')
    })

    it('fails closed when the setting cannot be read', async () => {
      getSession.mockResolvedValue(tgSession)
      adminAllowed.mockRejectedValue(new Error('db down'))
      hasAnyRole.mockResolvedValue(true)
      expect((await requireAdmin()).ok).toBe(false)
    })

    it('lets an admin through on a Telegram session once the setting is on', async () => {
      getSession.mockResolvedValue(tgSession)
      adminAllowed.mockResolvedValue(true)
      hasAnyRole.mockResolvedValue(true)
      expect((await requireAdmin()).ok).toBe(true)
    })

    it('never consults the setting for a Discord session', async () => {
      getSession.mockResolvedValue({ discordId: 'admin', createdAt: Date.now() })
      hasAnyRole.mockResolvedValue(true)
      expect((await requireAdmin()).ok).toBe(true)
      expect(adminAllowed).not.toHaveBeenCalled()
    })

    it('every role-gated route (payments, capos, reviewers) refuses a Telegram session too', async () => {
      getSession.mockResolvedValue(tgSession)
      adminAllowed.mockResolvedValue(false)
      hasAnyRole.mockResolvedValue(true)
      const r = await requireAnyRole(['some-role'])
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.response.status).toBe(403)
      expect(hasAnyRole).not.toHaveBeenCalled()
    })

    it('a Telegram session still works for ordinary member routes', async () => {
      getSession.mockResolvedValue(tgSession)
      expect((await requireSession()).ok).toBe(true)
    })
  })

  it('safeEqual compares strings safely', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual('abc', 'abcd')).toBe(false)
    expect(safeEqual(null, 'abc')).toBe(false)
    expect(safeEqual(undefined, undefined)).toBe(false)
  })

  it('checkSecret fails closed when the env var is unset', () => {
    delete process.env.TEST_GUARD_SECRET
    expect(checkSecret('anything', 'TEST_GUARD_SECRET')?.status).toBe(503)
    expect(checkSecret(undefined, 'TEST_GUARD_SECRET')?.status).toBe(503)
  })

  it('checkSecret validates the provided value', () => {
    process.env.TEST_GUARD_SECRET = 's3cret'
    expect(checkSecret('wrong', 'TEST_GUARD_SECRET')?.status).toBe(401)
    expect(checkSecret(null, 'TEST_GUARD_SECRET')?.status).toBe(401)
    expect(checkSecret('s3cret', 'TEST_GUARD_SECRET')).toBeNull()
    delete process.env.TEST_GUARD_SECRET
  })
})
