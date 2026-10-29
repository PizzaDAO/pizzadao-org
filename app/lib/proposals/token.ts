/**
 * Blind-signed ballot tokens (RSABSSA-SHA384-PSS-Randomized) under a PER-PROPOSAL key pair (see keys.ts).
 *
 * Issuance (the member's browser sends a BLINDED message; we sign it without seeing the token) and
 * voting (an unauthenticated request carries the unblinded token + signature) are separate requests,
 * made at different times by design, so nothing in the app can link a ballot to a member.
 *
 * Token format: proposal-<proposalId>-<uuid>. The signed "prepared message" is 32 random bytes followed
 * by UTF-8(token); the server checks that it really encodes the token, or one signature could be
 * replayed with unlimited fresh tokens. The key is the proposal's own, so a token minted under one proposal
 * and labelled for another fails both the label check and the signature check.
 */
import { blindSign, fromBase64, hashToken, importPrivateKey, importPublicKey } from '@/utils/blindRsa'
import { preparedMessageEncodesToken } from '@/utils/voteToken'
import { unwrapPrivateKey } from './keys'

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

// Imported keys are cached per proposal id for a short time, in a small bounded map. The unwrapped private key text is
// never a map key and is not kept: only the (non-extractable-by-us) imported CryptoKey is.
const KEY_TTL_MS = { private: 60_000, public: 5 * 60_000 } as const
const KEY_CACHE_MAX = 32
const keyCache = new Map<string, { key: Promise<CryptoKey>; expires: number }>()
function cachedKey(kind: 'private' | 'public', proposalId: string, fingerprint: string, load: () => Promise<string>): Promise<CryptoKey> {
  // The proposal id plus a tail of the stored key material, so a changed key can never hit a stale entry.
  const k = `${kind}:${proposalId}:${fingerprint.slice(-40)}`
  const now = Date.now()
  const hit = keyCache.get(k)
  if (hit && hit.expires > now) return hit.key
  for (const [name, v] of keyCache) if (v.expires <= now) keyCache.delete(name)
  while (keyCache.size >= KEY_CACHE_MAX) keyCache.delete(keyCache.keys().next().value as string)
  const key = load().then((pem) => (kind === 'private' ? importPrivateKey(pem) : importPublicKey(pem)))
  keyCache.set(k, { key, expires: now + KEY_TTL_MS[kind] })
  key.catch(() => keyCache.delete(k))
  return key
}

export class TokenConfigError extends Error {}

/** Sign a blinded message with THIS proposal's private key (unwrapped just for the call). */
export async function signBlinded(
  proposal: { id: string; keyPrivateEnc: string | null },
  blindedMessageB64: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  if (!proposal.keyPrivateEnc) throw new TokenConfigError('proposal has no signing key')
  const blinded = fromBase64(blindedMessageB64)
  if (blinded.length < 128 || blinded.length > 1024) throw new Error('bad blinded message')
  const enc = proposal.keyPrivateEnc
  const sig = await blindSign(await cachedKey('private', proposal.id, enc, () => unwrapPrivateKey(enc, proposal.id, env)), blinded)
  return Buffer.from(sig).toString('base64')
}

export interface BallotCredentials {
  token: string
  preparedMessage: string
  signature: string
}

/** Null when the credentials are valid for this proposal under its public key, else a short error. Never logs the token. */
export async function verifyBallotCredentials(
  proposal: { id: string; keyPublicPem: string | null },
  c: BallotCredentials,
): Promise<string | null> {
  if (!proposal.keyPublicPem) throw new TokenConfigError('proposal has no public key')
  let sig: Uint8Array
  let prepared: Uint8Array
  try {
    sig = fromBase64(c.signature)
    prepared = fromBase64(c.preparedMessage)
  } catch {
    return 'Invalid signature'
  }
  const binding = validateProposalTokenBinding(c.token, proposal.id, prepared)
  if (binding) return binding
  try {
    const pem = proposal.keyPublicPem
    const key = await cachedKey('public', proposal.id, pem.replace(/\s/g, '').slice(0, -30), async () => pem)
    const ok = await crypto.subtle.verify({ name: 'RSA-PSS', saltLength: SALT_LENGTH_SHA384 }, key, new Uint8Array(sig), new Uint8Array(prepared))
    return ok ? null : 'Invalid signature'
  } catch {
    return 'Invalid signature'
  }
}
