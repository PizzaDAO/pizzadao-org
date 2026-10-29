/**
 * Blind-signed ballot tokens (RSABSSA, the same suite and key pair as the retired /vote polls).
 *
 * Issuance (the member's browser sends a BLINDED message; we sign it without seeing the token) and
 * voting (an unauthenticated request carries the unblinded token + signature) are separate requests,
 * made at different times by design, so nothing in the app can link a ballot to a member.
 *
 * Token format: proposal-<proposalId>-<uuid>. The signed "prepared message" is 32 random bytes followed
 * by UTF-8(token); the server checks that it really encodes the token, or one signature could be
 * replayed with unlimited fresh tokens.
 */
import { blindSign, fromBase64, hashToken, importPrivateKey, importPublicKey } from '@/utils/blindRsa'
import { preparedMessageEncodesToken } from '@/utils/voteToken'

export const MAX_TOKEN_LENGTH = 512
const SALT_LENGTH_SHA384 = 48

export function isTokenForProposal(token: string, proposalId: string): boolean {
  const prefix = `proposal-${proposalId}-`
  return token.startsWith(prefix) && token.length > prefix.length && token.length <= MAX_TOKEN_LENGTH
}

/** Null when the token belongs to this proposal and the prepared message encodes it; else an error. */
export function validateProposalTokenBinding(token: string, proposalId: string, preparedMessage: Uint8Array): string | null {
  if (!isTokenForProposal(token, proposalId)) return 'Token is not for this proposal'
  if (!preparedMessageEncodesToken(preparedMessage, token)) return 'Token does not match signed message'
  return null
}

/** What the ballot row is keyed on. The token itself is never stored. */
export function ballotKey(proposalId: string, token: string): Promise<string> {
  return hashToken(`${proposalId}:${token}`)
}

const keyCache = new Map<string, Promise<CryptoKey>>()
function cachedKey(kind: 'private' | 'public', pem: string): Promise<CryptoKey> {
  const k = `${kind}:${pem}`
  let p = keyCache.get(k)
  if (!p) {
    p = kind === 'private' ? importPrivateKey(pem) : importPublicKey(pem)
    keyCache.set(k, p)
    p.catch(() => keyCache.delete(k))
  }
  return p
}

export class TokenConfigError extends Error {}

/** Sign a blinded message with the voting private key. Throws TokenConfigError when the key is not set. */
export async function signBlinded(blindedMessageB64: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const pem = env.RSA_PRIVATE_KEY_PEM
  if (!pem) throw new TokenConfigError('RSA_PRIVATE_KEY_PEM is not set')
  const blinded = fromBase64(blindedMessageB64)
  if (blinded.length < 64 || blinded.length > 1024) throw new Error('bad blinded message')
  const sig = await blindSign(await cachedKey('private', pem), blinded)
  return Buffer.from(sig).toString('base64')
}

export function publicKeyPem(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.RSA_PUBLIC_KEY_PEM?.trim() || null
}

export interface BallotCredentials {
  token: string
  preparedMessage: string
  signature: string
}

/** Null when the credentials are valid for this proposal, else a short error. Never logs the token. */
export async function verifyBallotCredentials(
  proposalId: string,
  c: BallotCredentials,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const pem = env.RSA_PUBLIC_KEY_PEM
  if (!pem) throw new TokenConfigError('RSA_PUBLIC_KEY_PEM is not set')
  let sig: Uint8Array
  let prepared: Uint8Array
  try {
    sig = fromBase64(c.signature)
    prepared = fromBase64(c.preparedMessage)
  } catch {
    return 'Invalid signature'
  }
  const binding = validateProposalTokenBinding(c.token, proposalId, prepared)
  if (binding) return binding
  try {
    const key = await cachedKey('public', pem)
    const ok = await crypto.subtle.verify({ name: 'RSA-PSS', saltLength: SALT_LENGTH_SHA384 }, key, new Uint8Array(sig), new Uint8Array(prepared))
    return ok ? null : 'Invalid signature'
  } catch {
    return 'Invalid signature'
  }
}
