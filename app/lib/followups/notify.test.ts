import { describe, it, expect, vi } from 'vitest'
vi.mock('@/app/lib/db')
vi.mock('@/app/lib/discord', () => ({ getMembersWithRoles: vi.fn(async () => []) }))

const tg = vi.hoisted(() => ({ available: true }))
vi.mock('./telegram', async (orig) => ({ ...(await orig<typeof import('./telegram')>()), telegramSenderAvailable: () => tg.available }))

import { TelegramApiError } from './telegram'
import { deliverToContacts, resolveContacts, type ContactDeps, type DeliverDeps } from './notify'

const deps = (holders: string[], accounts: Array<{ discordId: string; telegramId: string; dmAllowed: boolean }>): ContactDeps => ({
  roleHolders: async () => holders,
  accounts: async (ids) => accounts.filter((a) => ids.includes(a.discordId)),
})

describe('resolveContacts', () => {
  it('while the app has no Telegram sender, every contact is Discord-only', async () => {
    tg.available = false
    try {
      const c = await resolveContacts({ escalationDiscordIds: ['1'] }, deps([], [{ discordId: '1', telegramId: '901', dmAllowed: true }]))
      expect(c).toEqual([{ discordId: '1', telegramChatId: null }])
    } finally {
      tg.available = true
    }
  })
  it('uses the configured list, Telegram when allowed, else Discord', async () => {
    const c = await resolveContacts({ escalationDiscordIds: ['1', '2'] }, deps([], [{ discordId: '1', telegramId: '901', dmAllowed: true }]))
    expect(c).toEqual([
      { discordId: '1', telegramChatId: '901' },
      { discordId: '2', telegramChatId: null },
    ])
  })
  it('with no list: the approvers who linked Telegram (nobody is hard-coded)', async () => {
    const c = await resolveContacts(
      { escalationDiscordIds: [] },
      deps(['1', '2', '3'], [{ discordId: '2', telegramId: '902', dmAllowed: true }, { discordId: '3', telegramId: '903', dmAllowed: false }]),
    )
    expect(c).toEqual([{ discordId: '2', telegramChatId: '902' }])
  })
  it('with no list and nobody on Telegram: falls back to Discord DMs to the approvers', async () => {
    const c = await resolveContacts({ escalationDiscordIds: [] }, deps(['1', '2'], []))
    expect(c.map((x) => x.discordId)).toEqual(['1', '2'])
    expect(c.every((x) => x.telegramChatId === null)).toBe(true)
  })
  it('no approvers at all means no contacts', async () => {
    expect(await resolveContacts({ escalationDiscordIds: [] }, deps([], []))).toEqual([])
  })
})

describe('deliverToContacts', () => {
  const mk = (over: Partial<DeliverDeps> = {}): DeliverDeps => ({
    telegram: vi.fn(async () => ({ messageId: 1 })),
    discord: vi.fn(async () => ({ channelId: 'c', messageId: 'm' })),
    markNoDm: vi.fn(async () => {}),
    ...over,
  })
  it('counts deliveries and prefers Telegram', async () => {
    const d = mk()
    const n = await deliverToContacts([{ discordId: '1', telegramChatId: '901' }, { discordId: '2', telegramChatId: null }], 'hi', d)
    expect(n).toBe(2)
    expect(d.telegram).toHaveBeenCalledTimes(1)
    expect(d.discord).toHaveBeenCalledTimes(1)
  })
  it('falls back to Discord when Telegram refuses, and clears the permission', async () => {
    const d = mk({ telegram: vi.fn(async () => { throw new TelegramApiError('x', 403, 'Forbidden') }) })
    expect(await deliverToContacts([{ discordId: '1', telegramChatId: '901' }], 'hi', d)).toBe(1)
    expect(d.markNoDm).toHaveBeenCalledWith('901')
  })
  it('one unreachable contact does not stop the rest', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const d = mk({ discord: vi.fn().mockRejectedValueOnce(new Error('closed')).mockResolvedValue({ channelId: 'c', messageId: 'm' }) })
    expect(await deliverToContacts([{ discordId: '1', telegramChatId: null }, { discordId: '2', telegramChatId: null }], 'hi', d)).toBe(1)
  })
})
