// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const findMembers = vi.fn()
const findReminders = vi.fn()
const findFirstReminder = vi.fn()
const createReminder = vi.fn()
const sendDm = vi.fn()
const nonProd = vi.fn()

vi.mock('@/app/lib/db', () => ({
  prisma: {
    member: { findMany: (a: unknown) => findMembers(a) },
    memberNameReminder: {
      findMany: (a: unknown) => findReminders(a),
      findFirst: (a: unknown) => findFirstReminder(a),
      create: (a: unknown) => createReminder(a),
    },
  },
}))
vi.mock('@/app/lib/settings', () => ({
  getSetting: async (k: string) => (k === 'members.nameReminderCooldownDays' ? 30 : 'claim your name'),
}))
vi.mock('@/app/lib/followups/discord-dm', () => ({ sendDiscordDm: (...a: unknown[]) => sendDm(...a) }))
vi.mock('@/app/lib/admin-guard', () => ({ isNonProductionDeploy: () => nonProd() }))
vi.mock('@/app/lib/themed-name', () => ({ isThemedName: (n: string) => /pizza|pepperoni/i.test(n) }))

import { buildNameReport, sendNameReminders } from './name-reminders'

const NOW = new Date('2026-06-30T00:00:00Z')

beforeEach(() => {
  vi.resetAllMocks()
  nonProd.mockReturnValue(false)
  findMembers.mockResolvedValue([
    { id: '1', name: 'Pepperoni Pete', discordId: 'd1' },
    { id: '2', name: 'Plain Person', discordId: 'd2' },
    { id: '3', name: 'Other Person', discordId: null },
    { id: '4', name: 'Third Person', discordId: 'd4' },
  ])
})

describe('buildNameReport', () => {
  it('lists only non-themed members and flags the cooldown', async () => {
    findReminders.mockResolvedValue([{ discordId: 'd2', createdAt: new Date('2026-06-20T00:00:00Z') }])
    const r = await buildNameReport(NOW)
    expect(r.total).toBe(4)
    expect(r.nonThemed).toBe(3)
    expect(r.withoutDiscord).toBe(1)
    expect(r.rows.find((x) => x.id === '2')?.coolingDown).toBe(true)
    expect(r.rows.find((x) => x.id === '4')?.coolingDown).toBe(false)
  })
})

describe('sendNameReminders', () => {
  it('never sends from a preview', async () => {
    nonProd.mockReturnValue(true)
    const r = await sendNameReminders(['2'], 'admin', NOW)
    expect(sendDm).not.toHaveBeenCalled()
    expect(r.skipped).toHaveLength(1)
  })
  it('sends to eligible members, skips themed, missing Discord id and cooldown', async () => {
    findFirstReminder.mockImplementation(async (a: { where: { discordId: string } }) => (a.where.discordId === 'd2' ? { id: 'x' } : null))
    sendDm.mockResolvedValue({})
    const r = await sendNameReminders(['1', '2', '3', '4'], 'admin', NOW)
    expect(r.sent).toEqual(['4'])
    expect(r.skipped.map((s) => s.id).sort()).toEqual(['1', '2', '3'])
    expect(sendDm).toHaveBeenCalledTimes(1)
    expect(sendDm).toHaveBeenCalledWith('d4', 'claim your name')
    expect(createReminder).toHaveBeenCalledWith({ data: expect.objectContaining({ discordId: 'd4', status: 'SENT' }) })
  })
  it('records a failure and does not throw', async () => {
    findFirstReminder.mockResolvedValue(null)
    sendDm.mockRejectedValue(new Error('closed'))
    createReminder.mockResolvedValue({})
    const r = await sendNameReminders(['4'], 'admin', NOW)
    expect(r.failed).toEqual([{ id: '4', reason: 'closed' }])
    expect(createReminder).toHaveBeenCalledWith({ data: expect.objectContaining({ status: 'FAILED' }) })
  })
})
