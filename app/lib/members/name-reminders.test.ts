// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const findMembers = vi.fn()
const findReminders = vi.fn()
const findFirstReminder = vi.fn()
const createReminder = vi.fn()
const updateReminder = vi.fn()
const nonProd = vi.fn()

vi.mock('@/app/lib/db', () => ({
  prisma: {
    member: { findMany: (a: unknown) => findMembers(a) },
    memberNameReminder: {
      findMany: (a: unknown) => findReminders(a),
      findFirst: (a: unknown) => findFirstReminder(a),
      create: (a: unknown) => createReminder(a),
      update: (a: unknown) => updateReminder(a),
    },
  },
}))
vi.mock('@/app/lib/settings', () => ({
  getSetting: async (k: string) => (k === 'members.nameReminderCooldownDays' ? 30 : 'claim your name'),
}))
vi.mock('@/app/lib/admin-guard', () => ({ isNonProductionDeploy: () => nonProd() }))
vi.mock('@/app/lib/themed-name', () => ({ isThemedName: (n: string) => /pizza|pepperoni/i.test(n) }))

import { buildNameReport, sendNameReminders, MAX_PER_REQUEST } from './name-reminders'

const NOW = new Date('2026-06-30T00:00:00Z')
const send = vi.fn()
const sleep = vi.fn(async () => {})
const deps = { send: send as never, sleep }

beforeEach(() => {
  vi.resetAllMocks()
  nonProd.mockReturnValue(false)
  createReminder.mockResolvedValue({ id: 'c1' })
  updateReminder.mockResolvedValue({})
  findFirstReminder.mockResolvedValue(null)
  findMembers.mockResolvedValue([
    { id: '1', name: 'Pepperoni Pete', discordId: 'd1' },
    { id: '2', name: 'Plain Person', discordId: 'd2' },
    { id: '3', name: 'Other Person', discordId: null },
    { id: '4', name: 'Third Person', discordId: 'd4' },
    { id: '5', name: 'Fifth Person', discordId: 'd5' },
  ])
})

describe('buildNameReport', () => {
  it('lists only non-themed members, flags cooldown and shows the last status', async () => {
    findReminders.mockResolvedValue([
      { discordId: 'd2', createdAt: new Date('2026-06-20T00:00:00Z'), status: 'SENT' },
      { discordId: 'd4', createdAt: new Date('2026-06-20T00:00:00Z'), status: 'CLOSED' },
      { discordId: 'd5', createdAt: new Date('2026-06-20T00:00:00Z'), status: 'FAILED' },
    ])
    const r = await buildNameReport(NOW)
    expect(r.nonThemed).toBe(4)
    expect(r.withoutDiscord).toBe(1)
    expect(r.rows.find((x) => x.id === '2')?.coolingDown).toBe(true)
    expect(r.rows.find((x) => x.id === '4')).toMatchObject({ coolingDown: true, lastStatus: 'CLOSED' })
    expect(r.rows.find((x) => x.id === '5')).toMatchObject({ coolingDown: false, lastStatus: 'FAILED' })
  })
})

describe('sendNameReminders', () => {
  it('never sends from a preview', async () => {
    nonProd.mockReturnValue(true)
    const r = await sendNameReminders(['2'], 'admin', NOW, deps)
    expect(send).not.toHaveBeenCalled()
    expect(r.skipped).toHaveLength(1)
  })
  it('claims first, sends, settles SENT, and skips themed / no Discord id / cooldown', async () => {
    findFirstReminder.mockImplementation(async (a: { where: { discordId: string } }) => (a.where.discordId === 'd2' ? { status: 'SENT' } : null))
    send.mockResolvedValue({ kind: 'sent' })
    const r = await sendNameReminders(['1', '2', '3', '4'], 'admin', NOW, deps)
    expect(r.sent).toEqual(['4'])
    expect(r.skipped.map((s) => s.id).sort()).toEqual(['1', '2', '3'])
    expect(createReminder).toHaveBeenCalledWith({ data: expect.objectContaining({ discordId: 'd4', status: 'SENDING' }), select: { id: true } })
    expect(updateReminder).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { status: 'SENT' } })
  })
  it('skips a member already claimed by a concurrent send', async () => {
    createReminder.mockRejectedValue({ code: 'P2002' })
    const r = await sendNameReminders(['4'], 'admin', NOW, deps)
    expect(send).not.toHaveBeenCalled()
    expect(r.skipped[0].reason).toBe('Already being sent')
  })
  it('keeps the SENT result when settling the claim fails', async () => {
    send.mockResolvedValue({ kind: 'sent' })
    updateReminder.mockRejectedValue(new Error('db blip'))
    const r = await sendNameReminders(['4'], 'admin', NOW, deps)
    expect(r.sent).toEqual(['4'])
  })
  it('marks DMs closed as CLOSED (keeps the claim)', async () => {
    send.mockResolvedValue({ kind: 'closed' })
    const r = await sendNameReminders(['4'], 'admin', NOW, deps)
    expect(updateReminder).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { status: 'CLOSED' } })
    expect(r.skipped).toEqual([{ id: '4', reason: 'DMs closed' }])
  })
  it('stops the batch on a 429 and releases that claim', async () => {
    send.mockResolvedValue({ kind: 'rate_limited' })
    const r = await sendNameReminders(['4', '5'], 'admin', NOW, deps)
    expect(send).toHaveBeenCalledTimes(1)
    expect(updateReminder).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { status: 'FAILED', claimKey: null } })
    expect(r.skipped.map((s) => s.reason)).toEqual(['Not sent (rate limited)', 'Not sent (rate limited)'])
  })
  it('paces sends and caps a request', async () => {
    send.mockResolvedValue({ kind: 'sent' })
    const r = await sendNameReminders(['4', '5'], 'admin', NOW, deps)
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(sleep).toHaveBeenCalledWith(250)
    expect(r.sent).toEqual(['4', '5'])
    const many = Array.from({ length: MAX_PER_REQUEST + 3 }, (_, i) => `x${i}`)
    findMembers.mockResolvedValue([])
    const r2 = await sendNameReminders(many, 'admin', NOW, deps)
    expect(r2.skipped.filter((s) => s.reason.startsWith('Over the')).length).toBe(3)
  })
  it('records an uncertain failure as FAILED and releases the claim', async () => {
    send.mockResolvedValue({ kind: 'retry', code: 'http_502' })
    const r = await sendNameReminders(['4'], 'admin', NOW, deps)
    expect(r.failed).toEqual([{ id: '4', reason: 'http_502' }])
    expect(updateReminder).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { status: 'FAILED', claimKey: null } })
  })
})
