// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const pending = vi.fn()
const update = vi.fn()
vi.mock('./db', () => ({ prisma: { redemptionCode: { findMany: (a: unknown) => pending(a), updateMany: (a: unknown) => update(a) } } }))
vi.mock('./settings', () => ({ getSetting: async () => 'https://proofof.pizza' }))
const enabled = vi.fn()
vi.mock('./settings/toggles', () => ({ toggleEnabled: (...a: unknown[]) => enabled(...a) }))
const send = vi.fn()
vi.mock('./followups/discord-dm', () => ({ sendDiscordDm: (...a: unknown[]) => send(...a), isDmClosed: (e: unknown) => (e as { status?: number })?.status === 403 }))
vi.mock('./followups/store', () => ({ loadOwnerContext: async () => ({ locale: 'fr' }) }))

import { notifyRedemptionCodes, renderCodeDm } from './redemption-code-dm'

beforeEach(() => {
  vi.clearAllMocks()
  enabled.mockResolvedValue(true)
  pending.mockResolvedValue([{ code: 'AB23' }])
  send.mockResolvedValue({ channelId: 'c', messageId: 'm' })
})

describe('renderCodeDm', () => {
  it('has the code, the steps and the site, in the member locale', async () => {
    const en = await renderCodeDm(['AB23'], 'en', 'https://proofof.pizza')
    expect(en).toContain('**AB23**')
    expect(en).toContain('https://proofof.pizza')
    expect(en).toContain('3.')
    expect(await renderCodeDm(['AB23'], 'fr', 'https://proofof.pizza')).toContain('Rendez-vous')
    expect(await renderCodeDm(['AB23'], 'es', 'https://proofof.pizza')).toContain('Ve a')
    expect(await renderCodeDm(['AB23'], 'xx', 'https://proofof.pizza')).toContain('Go to')
  })
  it('lists several codes', async () => {
    expect(await renderCodeDm(['AB23', 'CD45'], 'en', 'https://proofof.pizza')).toContain('**AB23**, **CD45**')
  })
})

describe('notifyRedemptionCodes', () => {
  it('sends once and marks dmSentAt', async () => {
    expect(await notifyRedemptionCodes('u1', ['AB23'])).toBe(true)
    expect(send).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith({ where: { code: { in: ['AB23'] } }, data: { dmSentAt: expect.any(Date) } })
  })
  it('does nothing while the toggle is off or there is nothing new', async () => {
    enabled.mockResolvedValue(false)
    expect(await notifyRedemptionCodes('u1', ['AB23'])).toBe(false)
    enabled.mockResolvedValue(true)
    pending.mockResolvedValue([]) // already DMed
    expect(await notifyRedemptionCodes('u1', ['AB23'])).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })
  it('swallows a closed DM and does not mark it sent', async () => {
    send.mockRejectedValue(Object.assign(new Error('closed'), { status: 403 }))
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(await notifyRedemptionCodes('u1', ['AB23'])).toBe(false)
    expect(update).not.toHaveBeenCalled()
  })
})
