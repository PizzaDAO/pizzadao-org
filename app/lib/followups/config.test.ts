import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
vi.mock('@/app/lib/db')

import { prisma } from '@/app/lib/db'
import { clearSettingsCache } from '@/app/lib/settings'
import { envSendOff, loadFollowUpConfig, parseList } from './config'
import { SETTINGS, parseSetting } from '@/app/lib/settings/registry'

const findMany = vi.mocked(prisma.appSetting.findMany)
const PROD = { VERCEL_ENV: 'production' }

beforeEach(() => {
  clearSettingsCache({ all: true })
  findMany.mockReset()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('follow-up settings defaults', () => {
  it('sending is OFF by default; caps and quiet hours match the decision', async () => {
    findMany.mockResolvedValue([])
    const c = await loadFollowUpConfig(PROD)
    expect(c.sendEnabled).toBe(false)
    expect(c.draftEnabled).toBe(true)
    expect(c.maxPerDay).toBe(3)
    expect(c.quietStartHour).toBe(21)
    expect(c.quietEndHour).toBe(9)
    expect(c.draftCrews).toEqual([])
    expect(c.escalationDiscordIds).toEqual([])
    expect(c.footerTelegram).toMatch(/Reply STOP/)
    expect(c.footerDiscord).toBe('Tap Stop to stop these messages.')
    expect(c.footerDiscord).not.toMatch(/Reply/)
    expect(c.approvalMaxDays).toBe(7)
    expect(c.maxAlertsPerDay).toBe(5)
    expect([c.unknownTzStartHour, c.unknownTzEndHour]).toEqual([14, 22])
  })
  it('turns on only with the setting and no env kill switch', async () => {
    findMany.mockResolvedValue([{ key: 'followups.sendEnabled', value: 1 }] as never)
    expect((await loadFollowUpConfig(PROD)).sendEnabled).toBe(true)
    expect((await loadFollowUpConfig({ ...PROD, FOLLOWUPS_SEND_ENABLED: 'off' })).sendEnabled).toBe(false)
    expect((await loadFollowUpConfig({ ...PROD, FOLLOWUPS_SEND_ENABLED: '0' })).sendEnabled).toBe(false)
    expect((await loadFollowUpConfig({ ...PROD, FOLLOWUPS_SEND_ENABLED: 'on' })).sendEnabled).toBe(true)
  })
  it('a saved 1 is held on a preview or local deploy (they share the prod database)', async () => {
    findMany.mockResolvedValue([{ key: 'followups.sendEnabled', value: 1 }] as never)
    expect((await loadFollowUpConfig({ VERCEL_ENV: 'preview' })).sendEnabled).toBe(false)
    expect((await loadFollowUpConfig({ VERCEL_ENV: 'development' })).sendEnabled).toBe(false)
    expect((await loadFollowUpConfig({})).sendEnabled).toBe(false)
    expect((await loadFollowUpConfig(PROD)).sendEnabled).toBe(true)
  })
  it('fails safe: unreadable settings never send', async () => {
    findMany.mockResolvedValueOnce([{ key: 'followups.sendEnabled', value: 1 }] as never)
    expect((await loadFollowUpConfig(PROD)).sendEnabled).toBe(true)
    clearSettingsCache() // keeps last-known-good
    findMany.mockRejectedValue(new Error('db down'))
    expect((await loadFollowUpConfig(PROD)).sendEnabled).toBe(false)
  })
  it('an invalid stored value does not turn sending on', async () => {
    findMany.mockResolvedValue([{ key: 'followups.sendEnabled', value: 5 }] as never)
    expect((await loadFollowUpConfig(PROD)).sendEnabled).toBe(false)
  })
})

describe('registry entries', () => {
  it('validates bounds and id lists', () => {
    expect(parseSetting('followups.sendEnabled', 2).ok).toBe(false)
    expect(parseSetting('followups.maxPerDay', 0).ok).toBe(false)
    expect(parseSetting('followups.maxPerDay', 21).ok).toBe(false)
    expect(parseSetting('followups.quietStartHour', 24).ok).toBe(false)
    expect(parseSetting('followups.escalationDiscordIds', '123456789012345678, 234567890123456789').ok).toBe(true)
    expect(parseSetting('followups.escalationDiscordIds', 'someone').ok).toBe(false)
    expect(parseSetting('followups.escalationDiscordIds', '').ok).toBe(true)
    expect(parseSetting('followups.draftCrews', 'ops, other_crew').ok).toBe(true)
    expect(parseSetting('followups.draftCrews', 'ops; drop').ok).toBe(false)
    expect(parseSetting('followups.footerDiscord', '').ok).toBe(false)
  })
  it('the send switch is off by default and off when unreadable', () => {
    expect(SETTINGS['followups.sendEnabled'].default).toBe(0)
    expect(SETTINGS['followups.sendEnabled'].onReadFailure).toEqual({ value: 0 })
  })
  it('keys carry no secrets', () => {
    for (const k of Object.keys(SETTINGS).filter((k) => k.startsWith('followups.'))) expect(k).not.toMatch(/secret|token|password/i)
  })
})

describe('helpers', () => {
  it('parseList trims and dedupes', () => {
    expect(parseList(' a, b ,a,, c')).toEqual(['a', 'b', 'c'])
    expect(parseList('')).toEqual([])
  })
  it('envSendOff recognises off values only', () => {
    expect(envSendOff({})).toBe(false)
    expect(envSendOff({ FOLLOWUPS_SEND_ENABLED: 'OFF' })).toBe(true)
    expect(envSendOff({ FOLLOWUPS_SEND_ENABLED: 'false' })).toBe(true)
    expect(envSendOff({ FOLLOWUPS_SEND_ENABLED: '1' })).toBe(false)
  })
})
