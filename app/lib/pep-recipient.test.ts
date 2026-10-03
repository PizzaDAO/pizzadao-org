import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolvePepRecipient } from './pep-recipient'
import { prisma } from './db'

vi.mock('./db')
vi.mock('./sheets/member-repository', () => ({ getSheetData: vi.fn() }))

import { getSheetData } from './sheets/member-repository'

const mockFn = (f: unknown) => f as ReturnType<typeof vi.fn>
const DISCORD = '100000000000990001'

function sheet(rows: { memberId: string; discordId?: string }[]) {
  return {
    rows: rows.map((r) => ({ discordId: r.discordId })),
    memberToIdx: new Map(rows.map((r, i) => [r.memberId, i])),
    discordToMember: new Map(rows.filter((r) => r.discordId).map((r) => [r.discordId!, r.memberId])),
    timestamp: Date.now(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFn(prisma.user.findUnique).mockResolvedValue(null)
  mockFn(getSheetData).mockResolvedValue(sheet([{ memberId: '42', discordId: DISCORD }, { memberId: '43' }]))
})

describe('resolvePepRecipient', () => {
  it('maps a PizzaDAO member ID to that member’s Discord ID', async () => {
    await expect(resolvePepRecipient('42')).resolves.toBe(DISCORD)
    await expect(resolvePepRecipient(' 42 ')).resolves.toBe(DISCORD)
  })

  it('rejects an unknown member ID instead of creating an orphan wallet', async () => {
    await expect(resolvePepRecipient('999')).rejects.toThrow('No PizzaDAO member found with that member ID')
  })

  it('rejects a member without a linked Discord account', async () => {
    await expect(resolvePepRecipient('43')).rejects.toThrow('has not linked Discord')
  })

  it('accepts a Discord ID that has a User row or is on the sheet', async () => {
    await expect(resolvePepRecipient(DISCORD)).resolves.toBe(DISCORD) // on the sheet
    mockFn(prisma.user.findUnique).mockResolvedValue({ id: '123456789012345678' })
    await expect(resolvePepRecipient('123456789012345678')).resolves.toBe('123456789012345678')
  })

  it('rejects an unknown Discord ID', async () => {
    await expect(resolvePepRecipient('999999999999999999')).rejects.toThrow('No PizzaDAO member found with that Discord ID')
  })

  it('rejects garbage', async () => {
    for (const bad of ['', '   ', 'alice', '12a', '1'.repeat(21), null, undefined, {}]) {
      await expect(resolvePepRecipient(bad)).rejects.toThrow()
    }
  })

  it('fails closed when the members sheet is unavailable', async () => {
    mockFn(getSheetData).mockRejectedValue(new Error('sheet down'))
    await expect(resolvePepRecipient('42')).rejects.toThrow('Could not look up that member')
    await expect(resolvePepRecipient(DISCORD)).rejects.toThrow('No PizzaDAO member found')
  })
})
