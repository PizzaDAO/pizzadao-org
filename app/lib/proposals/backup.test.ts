// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { BACKUP_BLOB_LENGTH, backupMessage, decryptBallot, encryptBallot, type BackupPayload } from './backup'

// Stand-in for a 65-byte wallet signature (computed in the browser; never sent anywhere).
const SIG = '0x' + 'ab'.repeat(32) + 'cd'.repeat(32) + '1b'
const OTHER_SIG = '0x' + '12'.repeat(32) + '34'.repeat(32) + '1c'
const payload: BackupPayload = { token: 'proposal-p1-3f0c2a8e', preparedMessage: 'UFJFUA', signature: 'U0lH' }

describe('wallet-backed ballot backup', () => {
  it('uses a fixed, proposal-specific message to sign', () => {
    expect(backupMessage('p1')).toBe('PizzaDAO ballot backup v1 – p1')
  })

  it('round-trips with the same wallet signature', async () => {
    const blob = await encryptBallot(SIG, 'p1', payload)
    expect(await decryptBallot(SIG, 'p1', blob)).toEqual(payload)
  })

  it('the ciphertext holds neither the signature nor the token, so the server learns nothing', async () => {
    const blob = await encryptBallot(SIG, 'p1', payload)
    const plain = Buffer.from(blob, 'base64url').toString('latin1')
    for (const secret of [SIG.slice(2), 'proposal-p1', payload.token, payload.signature]) {
      expect(blob).not.toContain(secret)
      expect(plain).not.toContain(secret)
    }
    expect(blob).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('is randomised: encrypting twice gives different ciphertexts', async () => {
    expect(await encryptBallot(SIG, 'p1', payload)).not.toBe(await encryptBallot(SIG, 'p1', payload))
  })

  it('does not open with another wallet, another proposal or a tampered blob', async () => {
    const blob = await encryptBallot(SIG, 'p1', payload)
    expect(await decryptBallot(OTHER_SIG, 'p1', blob)).toBeNull()
    expect(await decryptBallot(SIG, 'p2', blob)).toBeNull()
    const flipped = blob.slice(0, -2) + (blob.endsWith('AA') ? 'BB' : 'AA')
    expect(await decryptBallot(SIG, 'p1', flipped)).toBeNull()
    expect(await decryptBallot(SIG, 'p1', 'garbage')).toBeNull()
  })

  it('refuses a backup whose token belongs to another proposal', async () => {
    const blob = await encryptBallot(SIG, 'p2', payload) // token says proposal-p1-...
    expect(await decryptBallot(SIG, 'p2', blob)).toBeNull()
  })

  it('every backup has the same exact length, whatever the contents', async () => {
    const small = await encryptBallot(SIG, 'p1', { token: 'proposal-p1-a', preparedMessage: 'x', signature: 'y' })
    const big = await encryptBallot(SIG, 'p1', { ...payload, signature: 'S'.repeat(700) })
    expect(small.length).toBe(BACKUP_BLOB_LENGTH)
    expect(big.length).toBe(BACKUP_BLOB_LENGTH)
    expect(BACKUP_BLOB_LENGTH).toBe(2768)
    await expect(encryptBallot(SIG, 'p1', { ...payload, signature: 'S'.repeat(3000) })).rejects.toThrow()
  })

  it('never stores a choice, even if the caller passes one', async () => {
    const blob = await encryptBallot(SIG, 'p1', { ...payload, choice: 'NAY' } as unknown as BackupPayload)
    const back = await decryptBallot(SIG, 'p1', blob)
    expect(back).toEqual(payload)
    expect(Object.keys(back!)).not.toContain('choice')
  })

  it('rejects a malformed signature', async () => {
    await expect(encryptBallot('not hex', 'p1', payload)).rejects.toThrow()
  })
})
