// @vitest-environment node
// Duplicate-account signals (flags only, §6.2).
import { describe, it, expect, vi } from 'vitest'

vi.mock('../db')
vi.mock('../sheets/member-repository', () => ({}))

import { computeSignals, type SignalInputs } from './signals'

const A = '100000000000000001'
const B = '100000000000000002'
const C = '100000000000000003'

const empty: SignalInputs = { wallets: [], xAccounts: [], telegram: [], completions: [], sheetRows: [] }
const run = (over: Partial<SignalInputs>) => computeSignals({ ...empty, ...over })

describe('computeSignals', () => {
  it('nothing shared, nothing flagged', () => {
    expect(
      run({
        wallets: [{ discordId: A, memberId: 'm1', walletAddress: '0xaaa' }, { discordId: B, memberId: 'm2', walletAddress: '0xbbb' }],
        xAccounts: [{ discordId: A, memberId: 'm1', xUsername: 'alice' }],
        sheetRows: [{ discordId: A, memberId: 'm1' }, { discordId: B, memberId: 'm2' }],
      }),
    ).toEqual([])
  })

  it('shared wallet across members (EVM addresses case-insensitive; discordId via the sheet when missing)', () => {
    const s = run({
      wallets: [
        { discordId: A, memberId: 'm1', walletAddress: '0xABCdef' },
        { discordId: null, memberId: 'm2', walletAddress: '0xabcDEF' },
        { discordId: A, memberId: 'm1', walletAddress: '0x111' },
      ],
      sheetRows: [{ discordId: A, memberId: 'm1' }, { discordId: B, memberId: 'm2' }],
    })
    expect(s).toEqual([{ kind: 'shared_wallet', key: '0xabcdef', discordIds: [A, B], memberIds: ['m1', 'm2'] }])
  })

  it('the same wallet listed twice for one member is not a signal', () => {
    expect(run({ wallets: [{ discordId: A, memberId: 'm1', walletAddress: '0xA' }, { discordId: A, memberId: 'm1', walletAddress: '0xa' }] })).toEqual([])
  })

  it('Solana addresses stay case-sensitive', () => {
    expect(
      run({
        wallets: [
          { discordId: A, memberId: 'm1', walletAddress: 'SoLAbc', chainType: 'solana' },
          { discordId: B, memberId: 'm2', walletAddress: 'solabc', chainType: 'solana' },
        ],
      }),
    ).toEqual([])
  })

  it('same X handle / Telegram username on two Discord accounts', () => {
    const s = run({
      xAccounts: [{ discordId: A, memberId: null, xUsername: '@Pizza' }, { discordId: B, memberId: null, xUsername: 'pizza' }],
      telegram: [{ discordId: A, memberId: null, username: 'tg1' }, { discordId: C, memberId: null, username: 'TG1' }, { discordId: B, memberId: null, username: null }],
    })
    expect(s).toEqual([
      { kind: 'shared_telegram', key: 'tg1', discordIds: [A, C], memberIds: [] },
      { kind: 'shared_x', key: 'pizza', discordIds: [A, B], memberIds: [] },
    ])
  })

  it('one members-sheet ID linked to several Discord accounts', () => {
    const s = run({
      xAccounts: [{ discordId: A, memberId: 'm1', xUsername: 'a' }],
      completions: [{ discordId: B, memberId: 'm1' }],
      sheetRows: [{ discordId: A, memberId: 'm1' }],
    })
    expect(s).toEqual([{ kind: 'shared_member_id', key: 'm1', discordIds: [A, B], memberIds: ['m1'], detail: { via: ['missions', 'sheet', 'x'] } }])
  })

  it('one Discord id on several members-sheet rows', () => {
    const s = run({ sheetRows: [{ discordId: A, memberId: 'm1' }, { discordId: A, memberId: 'm9' }] })
    expect(s).toEqual([{ kind: 'sheet_duplicate', key: A, discordIds: [A], memberIds: ['m1', 'm9'] }])
  })
})
