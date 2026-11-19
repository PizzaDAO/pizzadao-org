// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  emit: ((..._a: unknown[]) => undefined) as (...a: unknown[]) => void,
  required: false as boolean,
  save: (async (..._a: unknown[]) => ({}) as unknown) as (...a: unknown[]) => Promise<unknown>,
  verify: (async (..._a: unknown[]) => ({}) as unknown) as (...a: unknown[]) => Promise<unknown>,
}))

vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => unknown) => { void fn() } }))
vi.mock('@/app/lib/session', () => ({ getSession: async () => ({ discordId: 'd1' }) }))
vi.mock('@/app/lib/sheets/member-repository', () => ({ fetchMemberById: async () => ({ discordId: 'd1' }) }))
vi.mock('@/app/lib/settings/toggles', () => ({ toggleEnabled: async () => h.required }))
vi.mock('../profile/route', () => ({ writeToSheet: async () => undefined }))
vi.mock('@/app/lib/events-attended/rsv', () => ({ clearWalletMatches: async () => undefined, refreshRsvEventsIfEnabled: async () => undefined }))
vi.mock('@/app/lib/mission-verify/events', () => ({ emitMissionEvent: (...a: unknown[]) => { h.emit(...a); return Promise.resolve() } }))
vi.mock('@/app/lib/slices/claims', () => ({ promoteAwaitingWallet: async () => 0 }))
vi.mock('@/app/lib/slices/mint-queue', () => ({ processMintQueueSafe: async () => undefined }))
vi.mock('@/app/lib/wallet-lookup', () => ({
  getAllWalletsForMember: async () => [],
  saveWalletForMember: (...a: unknown[]) => h.save(...a),
  deleteWalletForMember: async () => undefined,
  updateWalletForMember: async () => undefined,
  setPrimaryWallet: async () => undefined,
  getWalletForMember: async () => null,
}))
vi.mock('@/app/lib/wallet-siwe', async (orig) => ({
  ...(await orig<typeof import('@/app/lib/wallet-siwe')>()),
  verifyWalletSiwe: (...a: unknown[]) => h.verify(...a),
}))

import { POST } from './route'
import { SiweError } from '@/app/lib/wallet-siwe'

const ADDR = '0x1234567890123456789012345678901234567890'
const SOL = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'

function post(body: Record<string, unknown>) {
  return POST(
    new NextRequest('https://app.pizzadao.org/api/wallet', {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: 'app.pizzadao.org' },
      body: JSON.stringify(body),
    })
  )
}

beforeEach(() => {
  h.required = false
  h.save = vi.fn(async () => ({ id: 1 }))
  h.verify = vi.fn(async () => undefined)
  h.emit = vi.fn()
})

describe('POST /api/wallet with wallets.requireSignature', () => {
  it('off: saves an unsigned EVM wallet as before and never verifies', async () => {
    const res = await post({ memberId: 'm1', walletAddress: ADDR })
    expect(res.status).toBe(200)
    expect(h.save).toHaveBeenCalledTimes(1)
    expect(h.verify).not.toHaveBeenCalled()
  })

  it('on: refuses an EVM wallet without a signature', async () => {
    h.required = true
    const res = await post({ memberId: 'm1', walletAddress: ADDR })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('signature_required')
    expect(h.save).not.toHaveBeenCalled()
  })

  it('on: saves after a verified signature, passing the member, session and host', async () => {
    h.required = true
    const res = await post({ memberId: 'm1', walletAddress: ADDR, message: 'msg', signature: '0xsig' })
    expect(res.status).toBe(200)
    expect(h.verify).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'msg', signature: '0xsig', address: ADDR, memberId: 'm1', discordId: 'd1', host: 'app.pizzadao.org' })
    )
    expect(h.save).toHaveBeenCalledTimes(1)
  })

  it('on: a failed verification saves nothing', async () => {
    h.required = true
    h.verify = vi.fn(async () => {
      throw new SiweError('nonce_used')
    })
    const res = await post({ memberId: 'm1', walletAddress: ADDR, message: 'msg', signature: '0xsig' })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('siwe_nonce_used')
    expect(h.save).not.toHaveBeenCalled()
  })

  it('on: Solana is not checked', async () => {
    h.required = true
    const res = await post({ memberId: 'm1', walletAddress: SOL, chainType: 'solana' })
    expect(res.status).toBe(200)
    expect(h.verify).not.toHaveBeenCalled()
  })

  it('a Solana paste skips the wallet mission re-check when on, and triggers it when off', async () => {
    h.required = true
    await post({ memberId: 'm1', walletAddress: SOL, chainType: 'solana' })
    expect(h.emit).not.toHaveBeenCalled()
    h.required = false
    await post({ memberId: 'm1', walletAddress: SOL, chainType: 'solana' })
    expect(h.emit).toHaveBeenCalledTimes(1)
  })
})
