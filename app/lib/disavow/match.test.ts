// @vitest-environment node
// Resolving typed identifiers to the person behind them, and back.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/db', () => ({
  prisma: {
    memberWallet: { findMany: vi.fn() },
    xAccount: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
    disavowIdentifier: { findFirst: vi.fn() },
  },
}))
vi.mock('@/app/lib/sheets/member-repository', () => ({
  fetchMemberById: vi.fn(async (id: string) => (id === '77' ? { discordId: 'subjD' } : null)),
  fetchMemberIdByDiscordId: vi.fn(async (d: string) => (d === 'subjD' ? '77' : null)),
}))
vi.mock('@/app/lib/wallet-lookup', () => ({
  getAllWalletsForMember: vi.fn(async (id: string) => (id === '77' ? [{ walletAddress: '0xABCDEF0123456789abcdef0123456789ABCDEF01' }] : [])),
}))

import { prisma } from '@/app/lib/db'
import { discordIdsForIdentifiers, resolveSubjectIdentifiers, viewerIdentifiers } from './match'

const m = (f: unknown) => f as ReturnType<typeof vi.fn>
const W = '0xabcdef0123456789abcdef0123456789abcdef01'

beforeEach(() => {
  vi.clearAllMocks()
  m(prisma.memberWallet.findMany).mockResolvedValue([])
  m(prisma.xAccount.findMany).mockResolvedValue([])
  m(prisma.xAccount.findFirst).mockResolvedValue({ xUsername: 'SubjX' })
  m(prisma.xAccount.findUnique).mockResolvedValue(null)
})

describe('resolveSubjectIdentifiers', () => {
  it('a wallet-only nomination also gets the member id, Discord id and X handle behind it', async () => {
    m(prisma.memberWallet.findMany).mockResolvedValue([{ memberId: '77', discordId: null }])
    const ids = await resolveSubjectIdentifiers([{ kind: 'WALLET', value: W }])
    expect(ids).toEqual(expect.arrayContaining([
      { kind: 'WALLET', value: W },
      { kind: 'MEMBER_ID', value: '77' },
      { kind: 'DISCORD_ID', value: 'subjD' },
      { kind: 'X_HANDLE', value: 'subjx' },
    ]))
  })
  it('an X-handle-only nomination resolves through the X account', async () => {
    m(prisma.xAccount.findMany).mockResolvedValue([{ memberId: null, discordId: 'subjD' }])
    const ids = await resolveSubjectIdentifiers([{ kind: 'X_HANDLE', value: 'subjx' }])
    expect(ids).toEqual(expect.arrayContaining([{ kind: 'MEMBER_ID', value: '77' }, { kind: 'DISCORD_ID', value: 'subjD' }]))
  })
  it('a Discord-id-only nomination gets the member id', async () => {
    const ids = await resolveSubjectIdentifiers([{ kind: 'DISCORD_ID', value: 'subjD' }])
    expect(ids).toEqual(expect.arrayContaining([{ kind: 'MEMBER_ID', value: '77' }, { kind: 'WALLET', value: W }]))
  })
  it('an unknown person keeps exactly what was typed; lookup errors never throw', async () => {
    expect(await resolveSubjectIdentifiers([{ kind: 'NAME', value: 'nobody' }])).toEqual([{ kind: 'NAME', value: 'nobody' }])
    m(prisma.memberWallet.findMany).mockRejectedValue(new Error('db'))
    expect(await resolveSubjectIdentifiers([{ kind: 'WALLET', value: W }])).toEqual([{ kind: 'WALLET', value: W }])
  })
})

describe('viewerIdentifiers / discordIdsForIdentifiers', () => {
  it('the viewer\'s own wallets and X handle are part of who they are', async () => {
    const ids = await viewerIdentifiers('subjD')
    expect(ids).toEqual(expect.arrayContaining([
      { kind: 'DISCORD_ID', value: 'subjD' }, { kind: 'MEMBER_ID', value: '77' },
      { kind: 'WALLET', value: W }, { kind: 'X_HANDLE', value: 'subjx' },
    ]))
  })
  it('a wallet on an entry resolves to its owner\'s Discord account', async () => {
    m(prisma.memberWallet.findMany).mockResolvedValue([{ memberId: '77', discordId: null }])
    expect(await discordIdsForIdentifiers([{ kind: 'WALLET', value: W }])).toContain('subjD')
  })
})
