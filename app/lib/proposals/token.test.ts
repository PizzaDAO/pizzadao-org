// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { ballotKey, isTokenForProposal, signBlinded, validateProposalTokenBinding, verifyBallotCredentials } from './token'
import { makeKeyEnv, mintCredentials, startBlind } from './test-utils'
import { fromBase64 } from '@/utils/blindRsa'

let env: NodeJS.ProcessEnv
beforeAll(async () => {
  env = await makeKeyEnv()
}, 30_000)

describe('blind ballot tokens', () => {
  it('a token signed blind verifies for its own proposal', async () => {
    const creds = await mintCredentials(env, 'prop1')
    expect(await verifyBallotCredentials('prop1', creds, env)).toBeNull()
  })

  it('the server signs without ever seeing the token', async () => {
    const b = await startBlind(env, 'prop1')
    expect(Buffer.from(fromBase64(b.blinded)).includes(Buffer.from(b.token))).toBe(false)
    expect(b.blinded).not.toContain(Buffer.from(b.token).toString('base64'))
  })

  it('is bound to the proposal: a token for another proposal is refused', async () => {
    const creds = await mintCredentials(env, 'prop1')
    expect(await verifyBallotCredentials('prop2', creds, env)).toBe('Token is not for this proposal')
  })

  it('rejects a forged signature and a signature replayed with a fresh token', async () => {
    const a = await mintCredentials(env, 'prop1')
    const b = await mintCredentials(env, 'prop1')
    expect(await verifyBallotCredentials('prop1', { ...a, signature: b.signature }, env)).toBe('Invalid signature')
    const fresh = `proposal-prop1-${crypto.randomUUID()}`
    expect(await verifyBallotCredentials('prop1', { ...a, token: fresh }, env)).toBe('Token does not match signed message')
  })

  it('rejects a signature from a different key pair', async () => {
    const other = await makeKeyEnv()
    const creds = await mintCredentials(other, 'prop1')
    expect(await verifyBallotCredentials('prop1', creds, env)).toBe('Invalid signature')
  })

  it('refuses garbage blinded messages and missing keys', async () => {
    await expect(signBlinded('AAAA', env)).rejects.toThrow()
    await expect(signBlinded('AAAA', {} as NodeJS.ProcessEnv)).rejects.toThrow(/RSA_PRIVATE_KEY_PEM/)
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
