import { describe, it, expect, vi, beforeEach } from 'vitest'

const getSession = vi.fn()
const hasAnyRole = vi.fn()
vi.mock('./session', () => ({ getSession: () => getSession() }))
vi.mock('./discord', () => ({ hasAnyRole: (...a: unknown[]) => hasAnyRole(...a) }))

import { requireSession, requireAdmin, safeEqual, checkSecret } from './auth-guards'
import { ADMIN_ROLE_IDS } from '@/app/ui/constants'

describe('auth guards', () => {
  beforeEach(() => {
    getSession.mockReset()
    hasAnyRole.mockReset()
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
