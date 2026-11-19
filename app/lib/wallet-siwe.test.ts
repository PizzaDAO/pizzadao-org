// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { recoverMessageAddress } from 'viem'
import { createSiweMessage } from 'viem/siwe'

process.env.SESSION_SECRET = 'test-secret'

const used = vi.hoisted(() => new Set<string>())
const contract = vi.hoisted(() => ({ ok: false }))
vi.mock('@/app/api/lib/cache', () => ({
  cacheLock: async (key: string) => {
    if (used.has(key)) return null
    used.add(key)
    return 'token'
  },
}))

// The real RPC is not reachable in tests: check the signature locally (the EOA case), keep every
// other check from viem's own verifySiweMessage.
vi.mock('viem/siwe', async (orig) => {
  const actual = await orig<typeof import('viem/siwe')>()
  return {
    ...actual,
    verifySiweMessage: async (
      _client: unknown,
      p: { message: string; signature: `0x${string}`; address?: `0x${string}`; domain?: string; nonce?: string; time?: Date }
    ) => {
      const parsed = actual.parseSiweMessage(p.message)
      if (!actual.validateSiweMessage({ address: p.address, domain: p.domain, message: parsed, nonce: p.nonce, time: p.time })) return false
      if (contract.ok) return true // a smart wallet the chain says is valid
      const who = await recoverMessageAddress({ message: p.message, signature: p.signature })
      return who.toLowerCase() === parsed.address?.toLowerCase()
    },
  }
})

import {
  SiweError,
  checkWalletNonce,
  issueWalletNonce,
  isAllowedSiweDomain,
  verifyWalletSiwe,
  walletStatement,
  NONCE_TTL_MS,
} from './wallet-siwe'

const HOST = 'app.pizzadao.org'
const MEMBER = '42'
const DISCORD = '1111'
const NOW = Date.UTC(2026, 10, 19, 12, 0, 0)
const account = privateKeyToAccount(generatePrivateKey())

async function signed(over: Partial<Parameters<typeof createSiweMessage>[0]> = {}, who = account, nonceFor = { m: MEMBER, d: DISCORD }) {
  const { nonce } = issueWalletNonce(nonceFor.m, nonceFor.d, NOW)
  const message = createSiweMessage({
    domain: HOST,
    uri: `https://${HOST}`,
    address: who.address,
    chainId: 1,
    nonce,
    statement: walletStatement(MEMBER),
    version: '1',
    issuedAt: new Date(NOW),
    expirationTime: new Date(NOW + NONCE_TTL_MS),
    ...over,
  })
  const signature = await who.signMessage({ message })
  return { message, signature }
}

const verify = (m: { message: string; signature: string }, over: Record<string, unknown> = {}) =>
  verifyWalletSiwe({
    message: m.message,
    signature: m.signature,
    address: account.address,
    memberId: MEMBER,
    discordId: DISCORD,
    host: HOST,
    now: NOW + 1000,
    getClient: () => ({}) as never,
    ...over,
  })

const code = async (p: Promise<unknown>) => {
  try {
    await p
    return 'ok'
  } catch (e) {
    return e instanceof SiweError ? e.code : `other:${String(e)}`
  }
}

beforeEach(() => {
  used.clear()
  contract.ok = false
})

describe('wallet nonce', () => {
  it('is alphanumeric and parses as a SIWE nonce', () => {
    const { nonce } = issueWalletNonce(MEMBER, DISCORD, NOW)
    expect(nonce).toMatch(/^[0-9a-f]{60}$/)
  })

  it('is valid for the member it was issued to, until the TTL', () => {
    const { nonce } = issueWalletNonce(MEMBER, DISCORD, NOW)
    expect(checkWalletNonce(nonce, MEMBER, DISCORD, NOW + 1000)).toBe('ok')
    expect(checkWalletNonce(nonce, MEMBER, DISCORD, NOW + NONCE_TTL_MS + 1)).toBe('expired')
  })

  it('is bound to the member and the session', () => {
    const { nonce } = issueWalletNonce(MEMBER, DISCORD, NOW)
    expect(checkWalletNonce(nonce, '43', DISCORD, NOW)).toBe('bad')
    expect(checkWalletNonce(nonce, MEMBER, '2222', NOW)).toBe('bad')
  })

  it('rejects a tampered expiry or random value', () => {
    const { nonce } = issueWalletNonce(MEMBER, DISCORD, NOW)
    const later = (parseInt(nonce.slice(16, 28), 16) + 600_000).toString(16).padStart(12, '0')
    expect(checkWalletNonce(nonce.slice(0, 16) + later + nonce.slice(28), MEMBER, DISCORD, NOW)).toBe('bad')
    expect(checkWalletNonce('x'.repeat(60), MEMBER, DISCORD, NOW)).toBe('bad')
  })
})

describe('verifyWalletSiwe', () => {
  it('accepts a good signature', async () => {
    expect(await code(verify(await signed()))).toBe('ok')
  })

  it('rejects a reused nonce', async () => {
    const m = await signed()
    expect(await code(verify(m))).toBe('ok')
    expect(await code(verify(m))).toBe('nonce_used')
  })

  it('rejects a wrong domain', async () => {
    const m = await signed({ domain: 'evil.example', uri: 'https://evil.example' })
    expect(await code(verify(m))).toBe('bad_domain')
  })

  it('rejects a domain that is not the request host', async () => {
    const m = await signed()
    expect(await code(verify(m, { host: 'someone-else.vercel.app' }))).toBe('bad_domain')
  })

  it('rejects a uri on another host', async () => {
    const m = await signed({ uri: 'https://evil.example' })
    expect(await code(verify(m))).toBe('bad_uri')
  })

  it('rejects a body address that differs from the signed one', async () => {
    const other = privateKeyToAccount(generatePrivateKey())
    expect(await code(verify(await signed(), { address: other.address }))).toBe('bad_address')
  })

  it('rejects a signature made by a different key', async () => {
    const other = privateKeyToAccount(generatePrivateKey())
    const m = await signed()
    const forged = await other.signMessage({ message: m.message })
    expect(await code(verify({ message: m.message, signature: forged }))).toBe('bad_signature')
  })

  it('rejects an expired message', async () => {
    const m = await signed()
    expect(await code(verify(m, { now: NOW + NONCE_TTL_MS + 5000 }))).toBe('expired')
  })

  it('rejects a message with no expiry', async () => {
    const m = await signed({ expirationTime: undefined })
    expect(await code(verify(m))).toBe('expired')
  })

  it('rejects a nonce issued to another member', async () => {
    const m = await signed({}, account, { m: '99', d: DISCORD })
    expect(await code(verify(m))).toBe('bad_nonce')
  })

  it('rejects a nonce that was not issued by the server', async () => {
    const m = await signed({ nonce: 'abcdef0123456789' })
    expect(await code(verify(m))).toBe('bad_nonce')
  })

  it('rejects an unsupported chain', async () => {
    expect(await code(verify(await signed({ chainId: 56 })))).toBe('bad_chain')
  })

  it('rejects a statement for another member', async () => {
    expect(await code(verify(await signed({ statement: walletStatement('7') })))).toBe('bad_statement')
  })

  it('rejects garbage', async () => {
    expect(await code(verify({ message: 'hello', signature: '0x00' }))).toBe('bad_message')
  })

  it('spends the nonce on a failed signature, so it cannot be tried again', async () => {
    const other = privateKeyToAccount(generatePrivateKey())
    const m = await signed()
    const forged = await other.signMessage({ message: m.message })
    await code(verify({ message: m.message, signature: forged }))
    expect(used.size).toBe(1)
    expect(await code(verify(m))).toBe('nonce_used')
  })
})

describe('non-finite dates', () => {
  it('rejects an invalid Issued At or Expiration Time as bad_message', async () => {
    const m = await signed()
    const bad1 = m.message.replace(/Issued At: .*/, 'Issued At: not-a-date')
    expect(await code(verify({ message: bad1, signature: m.signature }))).toBe('bad_message')
    const m2 = await signed()
    const bad2 = m2.message.replace(/Expiration Time: .*/, 'Expiration Time: 2026-99-99T99:99:99Z')
    expect(await code(verify({ message: bad2, signature: m2.signature }))).toBe('bad_message')
  })
})

describe('verifyWalletSiwe RPC use', () => {
  it('verifies an EOA by signature recovery without touching the RPC client', async () => {
    const getClient = vi.fn(() => ({}) as never)
    expect(await code(verify(await signed(), { getClient }))).toBe('ok')
    expect(getClient).not.toHaveBeenCalled()
  })

  it('falls back to the chain for a contract wallet (signer differs from the address)', async () => {
    const getClient = vi.fn(() => ({}) as never)
    const contractWallet = privateKeyToAccount(generatePrivateKey())
    const owner = privateKeyToAccount(generatePrivateKey())
    const m = await signed({ address: contractWallet.address }, owner)
    contract.ok = true
    expect(await code(verify(m, { address: contractWallet.address, getClient }))).toBe('ok')
    expect(getClient).toHaveBeenCalledTimes(1)
  })

  it('rejects when neither recovery nor the chain accepts it', async () => {
    const other = privateKeyToAccount(generatePrivateKey())
    const m = await signed()
    const forged = await other.signMessage({ message: m.message })
    expect(await code(verify({ message: m.message, signature: forged }))).toBe('bad_signature')
  })
})

describe('isAllowedSiweDomain', () => {
  it('allows the app hosts and rejects others', () => {
    expect(isAllowedSiweDomain('app.pizzadao.org', { VERCEL_ENV: 'production' })).toBe(true)
    expect(isAllowedSiweDomain('evil.example', {})).toBe(false)
    expect(isAllowedSiweDomain('onboarding-git-x-pizza-dao.vercel.app', { VERCEL_ENV: 'production' })).toBe(false)
    expect(isAllowedSiweDomain('onboarding-git-x-pizza-dao.vercel.app', { VERCEL_ENV: 'preview' })).toBe(true)
    expect(isAllowedSiweDomain('localhost:3000', { NODE_ENV: 'development' })).toBe(true)
    expect(isAllowedSiweDomain('localhost:3000', { NODE_ENV: 'production' })).toBe(false)
  })
})
