/**
 * Per-proposal signing keys. Each proposal gets its own RSA key pair when it opens, so a token (or a leaked key)
 * from one proposal means nothing on another, and the legacy poll key (RSA_PRIVATE_KEY_PEM) is never used here.
 * The private key is stored AES-GCM encrypted under a key derived (HKDF) from PROPOSAL_KEY_WRAP_SECRET, with the
 * proposal id as associated data so a wrapped key cannot be moved to another proposal's row.
 */
import { fingerprintOfPem } from './fingerprint'

export const MODULUS_BITS = 3072
export class KeyConfigError extends Error {}

function toPem(label: string, der: ArrayBuffer): string {
  const b64 = Buffer.from(der).toString('base64').match(/.{1,64}/g)!.join('\n')
  return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----`
}

export interface ProposalKeyPair {
  publicPem: string
  privatePem: string
  fingerprint: string
}

export async function generateProposalKeyPair(bits = MODULUS_BITS): Promise<ProposalKeyPair> {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSA-PSS', modulusLength: bits, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-384' },
    true,
    ['sign', 'verify'],
  )
  const publicPem = toPem('PUBLIC KEY', await crypto.subtle.exportKey('spki', pair.publicKey))
  const privatePem = toPem('PRIVATE KEY', await crypto.subtle.exportKey('pkcs8', pair.privateKey))
  return { publicPem, privatePem, fingerprint: await fingerprintOfPem(publicPem) }
}

async function wrapKey(env: NodeJS.ProcessEnv): Promise<CryptoKey> {
  const secret = env.PROPOSAL_KEY_WRAP_SECRET?.trim()
  if (!secret || secret.length < 32) throw new KeyConfigError('PROPOSAL_KEY_WRAP_SECRET must be set (at least 32 characters)')
  const ikm = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('pizzadao-proposal-key-wrap-v1'), info: new Uint8Array() },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function wrapPrivateKey(privatePem: string, proposalId: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(proposalId) }, await wrapKey(env), new TextEncoder().encode(privatePem)),
  )
  const out = new Uint8Array(iv.length + ct.length)
  out.set(iv)
  out.set(ct, iv.length)
  return Buffer.from(out).toString('base64')
}

export async function unwrapPrivateKey(blob: string, proposalId: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const raw = new Uint8Array(Buffer.from(blob, 'base64'))
  if (raw.length < 13) throw new Error('bad wrapped key')
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: raw.slice(0, 12), additionalData: new TextEncoder().encode(proposalId) },
    await wrapKey(env),
    raw.slice(12),
  )
  return new TextDecoder().decode(pt)
}
