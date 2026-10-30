import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
vi.mock('@/app/lib/db')
vi.mock('@/app/lib/discord', () => ({ getMembersWithRoles: vi.fn(async () => []) }))

import type { ReachRow } from '@/app/lib/telegram/reach'
import { deliverToContacts, resolveContacts, type ContactDeps, type DeliverDeps } from './notify'

const SENDER_ENV = { VERCEL_ENV: 'production', RSV_PIZZA_TELEGRAM_KEY: 'key' } as const
const on = { telegramDmEnabled: true }
const reach = (state: ReachRow['state'], recheckAt: Date | null = null): ReachRow => ({ state, failures: 0, recheckAt })

const deps = (holders: string[], accounts: Array<{ discordId: string; telegramId: string; reach: ReachRow | null }>): ContactDeps => ({
  roleHolders: async () => holders,
  accounts: async (ids) => accounts.filter((a) => ids.includes(a.discordId)),
})

describe('resolveContacts', () => {
  beforeEach(() => {
    for (const [k, v] of Object.entries(SENDER_ENV)) vi.stubEnv(k, v)
  })
  afterEach(() => vi.unstubAllEnvs())

  it('with the Telegram toggle off, every contact is Discord-only', async () => {
    const c = await resolveContacts({ escalationDiscordIds: ['1'], telegramDmEnabled: false }, deps([], [{ discordId: '1', telegramId: '901', reach: reach('OK') }]))
    expect(c).toEqual([{ discordId: '1', telegramChatId: null }])
  })
  it('on a preview (not production) every contact is Discord-only', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    const c = await resolveContacts({ escalationDiscordIds: ['1'], ...on }, deps([], [{ discordId: '1', telegramId: '901', reach: reach('OK') }]))
    expect(c).toEqual([{ discordId: '1', telegramChatId: null }])
  })
  it('uses the configured list, Telegram when reachable, else Discord', async () => {
    const c = await resolveContacts({ escalationDiscordIds: ['1', '2'], ...on }, deps([], [{ discordId: '1', telegramId: '901', reach: null }]))
    expect(c).toEqual([
      { discordId: '1', telegramChatId: '901' },
      { discordId: '2', telegramChatId: null },
    ])
  })
  it('with no list: the approvers who linked Telegram (nobody is hard-coded)', async () => {
    const c = await resolveContacts(
      { escalationDiscordIds: [], ...on },
      deps(['1', '2', '3'], [{ discordId: '2', telegramId: '902', reach: reach('OK') }, { discordId: '3', telegramId: '903', reach: reach('BLOCKED') }]),
    )
    expect(c).toEqual([{ discordId: '2', telegramChatId: '902' }])
  })
  it('with no list and nobody on Telegram: falls back to Discord DMs to the approvers', async () => {
    const c = await resolveContacts({ escalationDiscordIds: [], ...on }, deps(['1', '2'], []))
    expect(c.map((x) => x.discordId)).toEqual(['1', '2'])
    expect(c.every((x) => x.telegramChatId === null)).toBe(true)
  })
  it('no approvers at all means no contacts', async () => {
    expect(await resolveContacts({ escalationDiscordIds: [], ...on }, deps([], []))).toEqual([])
  })
})

describe('deliverToContacts', () => {
  const cfg = { dmRecheckDays: 7, dmRecheckMaxDays: 60 }
  const mk = (over: Partial<DeliverDeps> = {}): DeliverDeps => ({
    telegram: vi.fn(async () => ({ ok: true as const, messageId: 1 })),
    discord: vi.fn(async () => ({ channelId: 'c', messageId: 'm' })),
    recordReach: vi.fn(async () => {}),
    ...over,
  })
  const fail = (code: string) => vi.fn(async () => ({ ok: false as const, code: code as never }))
  it('counts deliveries and prefers Telegram', async () => {
    const d = mk()
    const n = await deliverToContacts([{ discordId: '1', telegramChatId: '901' }, { discordId: '2', telegramChatId: null }], 'hi', cfg, d)
    expect(n).toBe(2)
    expect(d.telegram).toHaveBeenCalledTimes(1)
    expect(vi.mocked(d.telegram).mock.calls[0][0].idempotencyKey).toMatch(/^[A-Za-z0-9:_-]{8,80}$/)
    expect(d.discord).toHaveBeenCalledTimes(1)
  })
  it('falls back to Discord when Telegram cannot reach them, and records it', async () => {
    const d = mk({ telegram: fail('not_started') })
    expect(await deliverToContacts([{ discordId: '1', telegramChatId: '901' }], 'hi', cfg, d)).toBe(1)
    expect(d.recordReach).toHaveBeenCalledWith('901', 'not_started', cfg)
  })
  it('a rate limit or config problem falls back to Discord without touching the reach', async () => {
    for (const code of ['rate_limited', 'unavailable', 'not_configured', 'bad_request']) {
      const d = mk({ telegram: fail(code) })
      expect(await deliverToContacts([{ discordId: '1', telegramChatId: '901' }], 'hi', cfg, d)).toBe(1)
      expect(d.recordReach).not.toHaveBeenCalled()
    }
  })
  it('uncertain never also sends on Discord', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const d = mk({ telegram: fail('uncertain') })
    expect(await deliverToContacts([{ discordId: '1', telegramChatId: '901' }], 'hi', cfg, d)).toBe(0)
    expect(d.discord).not.toHaveBeenCalled()
  })
  it('one unreachable contact does not stop the rest', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const d = mk({ discord: vi.fn().mockRejectedValueOnce(new Error('closed')).mockResolvedValue({ channelId: 'c', messageId: 'm' }) })
    expect(await deliverToContacts([{ discordId: '1', telegramChatId: null }, { discordId: '2', telegramChatId: null }], 'hi', cfg, d)).toBe(1)
  })
})
