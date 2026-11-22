import { describe, it, expect, vi, beforeEach } from 'vitest'

const getSession = vi.fn()
const isDpr = vi.fn()
const adminAllowed = vi.fn()
vi.mock('./session', () => ({ getSession: () => getSession() }))
vi.mock('./discord', () => ({ hasAnyRole: vi.fn() }))
vi.mock('@/app/lib/settings/toggles', () => ({ toggleEnabled: (...a: unknown[]) => adminAllowed(...a) }))
vi.mock('@/app/lib/mission-review-access', () => ({ isDreadPizzaRoberts: (...a: unknown[]) => isDpr(...a) }))

import { requireDpr } from './admin-guard'

describe('requireDpr on Telegram-started sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isDpr.mockResolvedValue(true)
  })

  it('refuses a DPR on a Telegram session while the setting is off, without checking the role', async () => {
    getSession.mockResolvedValue({ discordId: 'dpr', createdAt: Date.now(), authMethod: 'telegram' })
    adminAllowed.mockResolvedValue(false)
    const r = await requireDpr()
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.response.status).toBe(403)
    expect(isDpr).not.toHaveBeenCalled()
  })

  it('lets them through once the setting is on, and always for a Discord session', async () => {
    getSession.mockResolvedValue({ discordId: 'dpr', createdAt: Date.now(), authMethod: 'telegram' })
    adminAllowed.mockResolvedValue(true)
    expect((await requireDpr()).ok).toBe(true)
    getSession.mockResolvedValue({ discordId: 'dpr', createdAt: Date.now() })
    adminAllowed.mockClear()
    expect((await requireDpr()).ok).toBe(true)
    expect(adminAllowed).not.toHaveBeenCalled()
  })
})
