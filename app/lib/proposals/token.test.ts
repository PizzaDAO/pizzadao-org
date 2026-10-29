// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { ballotKey, isTokenForProposal, signBlinded, validateProposalTokenBinding, verifyBallotCredentials } from './token'
import { KeyConfigError, generateProposalKeyPair, unwrapPrivateKey, wrapPrivateKey } from './keys'
import { fingerprintOfPem, modulusOk } from './fingerprint'
import { makeProposalKey, mintCredentials, startBlind, testEnv, type TestKey } from './test-utils'
import { fromBase64 } from '@/utils/blindRsa'

const env = testEnv()
let P: TestKey
let Q: TestKey
beforeAll(async () => {
  P = await makeProposalKey('propP', env)
  Q = await makeProposalKey('propQ', env)
}, 60_000)

describe('blind ballot tokens (per-proposal keys)', () => {
  it('a token signed blind verifies for its own proposal', async () => {
    const creds = await mintCredentials(P, env)
    expect(await verifyBallotCredentials(P, creds)).toBeNull()
  })

  it('the server signs without ever seeing the token', async () => {
    const b = await startBlind(P.keyPublicPem, 'propP')
    expect(Buffer.from(fromBase64(b.blinded)).includes(Buffer.from(b.token))).toBe(false)
  })

  it('a token issued under P but labelled Q is refused on Q (and on P)', async () => {
    const forged = await mintCredentials(P, env, 'propQ') // P signs a token that says it is for Q
    expect(await verifyBallotCredentials(Q, forged)).toBe('Invalid signature') // Q's key never signed it
    expect(await verifyBallotCredentials(P, forged)).toBe('Token is not for this proposal') // and the label is wrong for P
  })

  it('a valid P token is refused on Q', async () => {
    const creds = await mintCredentials(P, env)
    expect(await verifyBallotCredentials(Q, creds)).toBe('Token is not for this proposal')
  })

  it('rejects a forged signature and a signature replayed with a fresh token', async () => {
    const a = await mintCredentials(P, env)
    const b = await mintCredentials(P, env)
    expect(await verifyBallotCredentials(P, { ...a, signature: b.signature })).toBe('Invalid signature')
    const fresh = `proposal-propP-${crypto.randomUUID()}`
    expect(await verifyBallotCredentials(P, { ...a, token: fresh })).toBe('Token does not match signed message')
  })

  it('refuses garbage blinded messages and missing wrap secret', async () => {
    await expect(signBlinded(P, 'AAAA', env)).rejects.toThrow()
    const b = await startBlind(P.keyPublicPem, 'propP')
    await expect(signBlinded(P, b.blinded, { VERCEL_ENV: 'production' } as unknown as NodeJS.ProcessEnv)).rejects.toBeInstanceOf(KeyConfigError)
  })

  it('never uses the legacy RSA_PRIVATE_KEY_PEM', async () => {
    const poisoned = { ...env, RSA_PRIVATE_KEY_PEM: 'not a key', RSA_PUBLIC_KEY_PEM: 'not a key' } as unknown as NodeJS.ProcessEnv
    const b = await startBlind(P.keyPublicPem, 'propP')
    expect(await signBlinded(P, b.blinded, poisoned)).toBeTruthy()
  })

  it('token format and ballot key', async () => {
    expect(isTokenForProposal('proposal-abc-123', 'abc')).toBe(true)
    expect(isTokenForProposal('proposal-abc-', 'abc')).toBe(false)
    expect(isTokenForProposal('poll-abc-123', 'abc')).toBe(false)
    expect(validateProposalTokenBinding('proposal-abc-1', 'abc', new Uint8Array(3))).toBe('Token does not match signed message')
    const k1 = await ballotKey('a', 't')
    expect(k1).toMatch(/^[0-9a-f]{64}$/)
    expect(await ballotKey('b', 't')).not.toBe(k1)
  })
})

describe('proposal key storage and fingerprint', () => {
  it('wraps the private key with AES-GCM, bound to the proposal id', async () => {
    const pair = await generateProposalKeyPair(2048)
    const wrapped = await wrapPrivateKey(pair.privatePem, 'p1', env)
    expect(wrapped).not.toContain('PRIVATE')
    expect(await unwrapPrivateKey(wrapped, 'p1', env)).toBe(pair.privatePem)
    await expect(unwrapPrivateKey(wrapped, 'p2', env)).rejects.toThrow() // moved to another proposal's row
    const other = { ...env, PROPOSAL_KEY_WRAP_SECRET: 'another-secret-another-secret-123456' } as unknown as NodeJS.ProcessEnv
    await expect(unwrapPrivateKey(wrapped, 'p1', other)).rejects.toThrow()
    await expect(wrapPrivateKey(pair.privatePem, 'p1', { PROPOSAL_KEY_WRAP_SECRET: 'short' } as unknown as NodeJS.ProcessEnv)).rejects.toBeInstanceOf(KeyConfigError)
  })

  it('fingerprints are stable and keys must be at least 2048 bits', async () => {
    const f = await fingerprintOfPem(P.keyPublicPem)
    expect(f).toMatch(/^([0-9a-f]{4} ){7}[0-9a-f]{4}$/)
    expect(await fingerprintOfPem(P.keyPublicPem)).toBe(f)
    expect(await fingerprintOfPem(Q.keyPublicPem)).not.toBe(f)
    expect(await modulusOk(P.keyPublicPem)).toBe(true)
    const small = await generateProposalKeyPair(1024)
    expect(await modulusOk(small.publicPem)).toBe(false)
    expect(await modulusOk('garbage')).toBe(false)
  })
})
