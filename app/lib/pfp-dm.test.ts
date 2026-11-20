// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/db', () => ({ prisma: { notification: { findFirst: vi.fn(), create: vi.fn() } } }))
vi.mock('@/app/lib/settings/toggles', () => ({ toggleEnabled: vi.fn() }))
vi.mock('@/app/lib/settings', () => ({ getSetting: vi.fn() }))
vi.mock('@/app/lib/rate-limit', () => ({ checkKeyedRateLimit: vi.fn() }))
vi.mock('@/app/lib/reminders/deliver', () => ({ deliverDm: vi.fn(), reminderSendAllowed: vi.fn() }))
vi.mock('@/app/lib/sheets/member-repository', () => ({ fetchMemberIdByDiscordId: vi.fn() }))
vi.mock('@/app/lib/pfp-assets/access', () => ({ loadEditAccess: vi.fn() }))

import { prisma } from '@/app/lib/db'
import { toggleEnabled } from '@/app/lib/settings/toggles'
import { getSetting } from '@/app/lib/settings'
import { checkKeyedRateLimit } from '@/app/lib/rate-limit'
import { deliverDm, reminderSendAllowed } from '@/app/lib/reminders/deliver'
import { fetchMemberIdByDiscordId } from '@/app/lib/sheets/member-repository'
import { loadEditAccess } from '@/app/lib/pfp-assets/access'
import { maybeSendPfpReadyDm, maybeSendPfpUnlockedDm } from './pfp-dm'

const m = (f: unknown) => f as ReturnType<typeof vi.fn>
const toggles: Record<string, boolean> = {}

beforeEach(() => {
  vi.clearAllMocks()
  toggles['pfp.unlockedDmEnabled'] = true
  toggles['pfp.readyDmEnabled'] = true
  m(toggleEnabled).mockImplementation(async (k: string) => toggles[k])
  m(reminderSendAllowed).mockReturnValue(true)
  m(getSetting).mockResolvedValue(2)
  m(prisma.notification.findFirst).mockResolvedValue(null)
  m(fetchMemberIdByDiscordId).mockResolvedValue('42')
  m(deliverDm).mockResolvedValue({ kind: 'sent' })
  m(loadEditAccess).mockResolvedValue({ allowed: true, completed: 2, minLevel: 2, bypass: false })
  m(checkKeyedRateLimit).mockResolvedValue({ success: true, limit: 1, remaining: 0, reset: Date.now() + 1000 })
})

describe('maybeSendPfpUnlockedDm', () => {
  it('DMs once when the PFP level is paid, with a link, and records the marker first', async () => {
    await maybeSendPfpUnlockedDm('d1', 2)
    expect(prisma.notification.create).toHaveBeenCalledOnce()
    const text = m(deliverDm).mock.calls[0][0].text as string
    expect(text).toContain('level 2')
    expect(text).toContain('/profile/42/pfp')
    expect(m(prisma.notification.create).mock.invocationCallOrder[0]).toBeLessThan(m(deliverDm).mock.invocationCallOrder[0])
  })

  it('does not send again when the marker exists', async () => {
    m(prisma.notification.findFirst).mockResolvedValue({ id: 'n1' })
    await maybeSendPfpUnlockedDm('d1', 2)
    expect(deliverDm).not.toHaveBeenCalled()
    expect(prisma.notification.create).not.toHaveBeenCalled()
  })

  it('ignores other levels', async () => {
    await maybeSendPfpUnlockedDm('d1', 1)
    await maybeSendPfpUnlockedDm('d1', 3)
    expect(deliverDm).not.toHaveBeenCalled()
  })

  it('sends nothing with the toggle off, or off production', async () => {
    toggles['pfp.unlockedDmEnabled'] = false
    await maybeSendPfpUnlockedDm('d1', 2)
    toggles['pfp.unlockedDmEnabled'] = true
    m(reminderSendAllowed).mockReturnValue(false)
    await maybeSendPfpUnlockedDm('d1', 2)
    expect(deliverDm).not.toHaveBeenCalled()
    expect(prisma.notification.create).not.toHaveBeenCalled()
  })

  it('never throws when the DM fails or the database is down', async () => {
    m(deliverDm).mockResolvedValue({ kind: 'closed' })
    await expect(maybeSendPfpUnlockedDm('d1', 2)).resolves.toBeUndefined()
    m(prisma.notification.findFirst).mockRejectedValue(new Error('db down'))
    await expect(maybeSendPfpUnlockedDm('d1', 2)).resolves.toBeUndefined()
  })
})

describe('maybeSendPfpReadyDm', () => {
  it('DMs a link to the PFP page', async () => {
    await maybeSendPfpReadyDm('d1')
    expect(m(deliverDm).mock.calls[0][0].text).toContain('/profile/42/pfp')
    expect(checkKeyedRateLimit).toHaveBeenCalledWith('pfp-ready-dm', 'd1', undefined, { failClosed: true })
  })

  it('is throttled: no DM when the 10-minute window is used', async () => {
    m(checkKeyedRateLimit).mockResolvedValue({ success: false, limit: 1, remaining: 0, reset: Date.now() + 1000 })
    await maybeSendPfpReadyDm('d1')
    expect(deliverDm).not.toHaveBeenCalled()
  })

  it('sends nothing with the toggle off', async () => {
    toggles['pfp.readyDmEnabled'] = false
    await maybeSendPfpReadyDm('d1')
    expect(deliverDm).not.toHaveBeenCalled()
    expect(checkKeyedRateLimit).not.toHaveBeenCalled()
  })

  it('skips members who cannot use the PFP editor yet', async () => {
    m(loadEditAccess).mockResolvedValue({ allowed: false, completed: 1, minLevel: 2, bypass: false })
    await maybeSendPfpReadyDm('d1')
    expect(deliverDm).not.toHaveBeenCalled()
  })

  it('never throws when sending fails', async () => {
    m(deliverDm).mockRejectedValue(new Error('discord down'))
    await expect(maybeSendPfpReadyDm('d1')).resolves.toBeUndefined()
  })
})
