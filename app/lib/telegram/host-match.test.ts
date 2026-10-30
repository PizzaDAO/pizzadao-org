// @vitest-environment node
import { createHash } from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/lib/db')
const getSheetData = vi.fn()
vi.mock('@/app/lib/sheets/member-repository', () => ({ getSheetData: () => getSheetData() }))

import { prisma } from '@/app/lib/db'
import { clearSettingsCache } from '@/app/lib/settings'
import { emailHash, runHostMatch } from './host-match'
import type { HostMatchResult } from './rsv-client'

const PROD = { VERCEL_ENV: 'production', RSV_PIZZA_TELEGRAM_KEY: 'k' }
const NOW = new Date('2026-11-10T12:00:00Z')
const sha = (s: string) => createHash('sha256').update(s).digest('hex')

function settings(o: Record<string, unknown>) {
  vi.mocked(prisma.appSetting.findMany).mockResolvedValue(Object.entries(o).map(([key, value]) => ({ key, value })) as never)
  clearSettingsCache({ all: true })
}
const members = (list: Array<{ id: string; discordId: string; email: string }>) => {
  vi.mocked(prisma.memberProfileExtras.findMany).mockResolvedValue(list.map((m) => ({ memberId: m.id, email: m.email })) as never)
  getSheetData.mockResolvedValue({ memberToIdx: new Map(list.map((m, i) => [m.id, i])), rows: list.map((m) => ({ discordId: m.discordId })) })
}
const none = () => {
  vi.mocked(prisma.telegramAccount.findMany).mockResolvedValue([])
  vi.mocked(prisma.telegramHostMatch.findMany).mockResolvedValue([])
  vi.mocked(prisma.telegramHostMatchCheck.findMany).mockResolvedValue([])
}

beforeEach(() => {
  vi.resetAllMocks()
  settings({ 'telegram.hostMatchEnabled': true })
  vi.mocked(prisma.telegramHostMatchCheck.count).mockResolvedValue(0)
  vi.mocked(prisma.telegramHostMatchCheck.upsert).mockResolvedValue({} as never)
  vi.mocked(prisma.telegramHostMatch.create).mockResolvedValue({} as never)
  vi.mocked(prisma.telegramAccount.findUnique).mockResolvedValue(null)
  vi.mocked(prisma.telegramHostMatch.findUnique).mockResolvedValue(null)
  none()
})

const noSleep = async () => {}

describe('emailHash', () => {
  it('hashes the lower-cased, trimmed address', () => {
    expect(emailHash('  Host@Example.org ')).toBe(sha('host@example.org'))
    expect(emailHash('x@y.zz')).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('runHostMatch gates', () => {
  it('does nothing and calls nothing when the toggle is off, on a preview, or with the kill switch', async () => {
    const match = vi.fn()
    settings({})
    members([{ id: 'm1', discordId: '11111', email: 'a@x.org' }])
    expect((await runHostMatch({ now: NOW, env: PROD, match })).skipped).toBe('off')
    settings({ 'telegram.hostMatchEnabled': true })
    expect((await runHostMatch({ now: NOW, env: { ...PROD, VERCEL_ENV: 'preview' }, match })).skipped).toBe('off')
    expect((await runHostMatch({ now: NOW, env: { ...PROD, TELEGRAM_HOST_MATCH_ENABLED: 'off' }, match })).skipped).toBe('off')
    expect((await runHostMatch({ now: NOW, env: { ...PROD, TELEGRAM_SENDS_ENABLED: 'off' }, match })).skipped).toBe('off')
    expect(match).not.toHaveBeenCalled()
  })

  it('stops when the daily budget is used up', async () => {
    const match = vi.fn()
    members([{ id: 'm1', discordId: '11111', email: 'a@x.org' }])
    vi.mocked(prisma.telegramHostMatchCheck.count).mockResolvedValue(1000)
    expect((await runHostMatch({ now: NOW, env: PROD, match })).skipped).toBe('budget')
    expect(match).not.toHaveBeenCalled()
  })
})

describe('runHostMatch candidates', () => {
  it('sends only hashes of verified, in-sheet members, and skips logins, existing matches, recent checks and shared addresses', async () => {
    members([
      { id: 'm1', discordId: '11111', email: 'one@x.org' },
      { id: 'm2', discordId: '22222', email: 'two@x.org' }, // has a Telegram login
      { id: 'm3', discordId: '33333', email: 'three@x.org' }, // already has a match row (maybe declined)
      { id: 'm4', discordId: '44444', email: 'four@x.org' }, // checked recently
      { id: 'm5', discordId: '55555', email: 'Shared@x.org' },
      { id: 'm6', discordId: '66666', email: 'shared@x.org' }, // same address as m5: ambiguous, neither
      { id: 'm7', discordId: 'not-a-discord-id', email: 'seven@x.org' },
      { id: 'm8', discordId: '88888', email: 'not an email' },
    ])
    vi.mocked(prisma.telegramAccount.findMany).mockResolvedValue([{ discordId: '22222' }] as never)
    vi.mocked(prisma.telegramHostMatch.findMany).mockResolvedValue([{ discordId: '33333' }] as never)
    vi.mocked(prisma.telegramHostMatchCheck.findMany).mockResolvedValue([{ memberId: 'm4' }] as never)
    const match = vi.fn(async (): Promise<HostMatchResult> => ({ ok: true, matches: [] }))
    const r = await runHostMatch({ now: NOW, env: PROD, match, sleep: noSleep })
    expect(match).toHaveBeenCalledTimes(1)
    expect(match.mock.calls[0]).toEqual([[sha('one@x.org')]])
    expect(r).toMatchObject({ candidates: 1, checked: 1, matched: 0 })
    expect(vi.mocked(prisma.telegramHostMatchCheck.upsert)).toHaveBeenCalledWith(expect.objectContaining({ where: { memberId: 'm1' } }))
  })
})

describe('runHostMatch hits', () => {
  const two = [
    { id: 'm1', discordId: '11111', email: 'one@x.org' },
    { id: 'm2', discordId: '22222', email: 'two@x.org' },
  ]

  it('stores a hit as a PENDING suggestion, never as confirmed', async () => {
    members(two)
    const match = vi.fn(async (): Promise<HostMatchResult> => ({ ok: true, matches: [{ emailHash: sha('one@x.org'), telegramUserId: '5551', handleHint: 'al…' }] }))
    const r = await runHostMatch({ now: NOW, env: PROD, match, sleep: noSleep })
    expect(r).toMatchObject({ checked: 2, matched: 1, conflicts: 0 })
    expect(vi.mocked(prisma.telegramHostMatch.create)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(prisma.telegramHostMatch.create).mock.calls[0][0].data).toEqual({ discordId: '11111', memberId: 'm1', telegramId: '5551', handleHint: 'al…', matchedBy: 'email', consent: 'PENDING' })
  })

  it('a Telegram id already linked by login to someone else, or suggested to someone else, is dropped', async () => {
    members(two)
    vi.mocked(prisma.telegramAccount.findUnique).mockResolvedValueOnce({ discordId: '99999' } as never)
    vi.mocked(prisma.telegramHostMatch.findUnique).mockResolvedValueOnce(null).mockResolvedValueOnce({ discordId: '88888' } as never)
    const match = vi.fn(async (): Promise<HostMatchResult> => ({
      ok: true,
      matches: [
        { emailHash: sha('one@x.org'), telegramUserId: '5551', handleHint: null },
        { emailHash: sha('two@x.org'), telegramUserId: '5552', handleHint: null },
      ],
    }))
    const logs = vi.spyOn(console, 'log')
    const r = await runHostMatch({ now: NOW, env: PROD, match, sleep: noSleep })
    expect(r).toMatchObject({ matched: 0, conflicts: 2 })
    expect(prisma.telegramHostMatch.create).not.toHaveBeenCalled()
    expect(logs).not.toHaveBeenCalled()
  })

  it('a unique race on create counts as a conflict and never overwrites', async () => {
    members(two.slice(0, 1))
    vi.mocked(prisma.telegramHostMatch.create).mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }))
    const match = vi.fn(async (): Promise<HostMatchResult> => ({ ok: true, matches: [{ emailHash: sha('one@x.org'), telegramUserId: '5551', handleHint: null }] }))
    expect(await runHostMatch({ now: NOW, env: PROD, match, sleep: noSleep })).toMatchObject({ matched: 0, conflicts: 1 })
    expect(prisma.telegramHostMatch.update).not.toHaveBeenCalled()
    expect(prisma.telegramHostMatch.upsert).not.toHaveBeenCalled()
  })
})

describe('runHostMatch pacing and limits', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `m${String(i).padStart(4, '0')}`, discordId: String(10000 + i), email: `u${i}@x.org` }))

  it('batches of 100, a pause between requests, at most 3 requests a run', async () => {
    members(many(250))
    const sleep = vi.fn(async () => {})
    const match = vi.fn(async (h: string[]): Promise<HostMatchResult> => ({ ok: true, matches: [] }))
    const r = await runHostMatch({ now: NOW, env: PROD, match, sleep })
    expect(match.mock.calls.map((c) => c[0].length)).toEqual([100, 100, 50])
    expect(sleep).toHaveBeenCalledTimes(2)
    expect(sleep.mock.calls.every((c) => (c as unknown as number[])[0] >= 6000)).toBe(true)
    expect(r.checked).toBe(250)
  })

  it('never asks for more than the day has left', async () => {
    members(many(250))
    vi.mocked(prisma.telegramHostMatchCheck.count).mockResolvedValue(960)
    const match = vi.fn(async (): Promise<HostMatchResult> => ({ ok: true, matches: [] }))
    const r = await runHostMatch({ now: NOW, env: PROD, match, sleep: noSleep })
    expect(r.checked).toBe(40)
  })

  it.each(['rate_limited', 'daily_cap', 'disabled', 'unavailable'] as const)('stops on %s without marking that batch as checked', async (reason) => {
    members(many(150))
    const match = vi.fn(async (): Promise<HostMatchResult> => ({ ok: false, reason }))
    const r = await runHostMatch({ now: NOW, env: PROD, match, sleep: noSleep })
    expect(match).toHaveBeenCalledTimes(1)
    expect(r).toMatchObject({ stopped: reason, checked: 0 })
    expect(prisma.telegramHostMatchCheck.upsert).not.toHaveBeenCalled()
  })
})
