/**
 * Discord HTTP Interactions request verification (Ed25519).
 * https://discord.com/developers/docs/interactions/overview#setting-up-an-endpoint-validating-security-request-headers
 *
 * Discord signs `timestamp + rawBody` with the application's key; the public
 * key (hex, from the Developer Portal) is DISCORD_PUBLIC_KEY. Uses node:crypto
 * only, no extra dependency.
 */
import { createPublicKey, verify } from 'node:crypto'

// DER SubjectPublicKeyInfo prefix for a raw 32-byte Ed25519 key.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

/** Reject signatures older than this (replay protection). */
export const MAX_SKEW_SECONDS = 300

export function verifyDiscordRequest(opts: {
  publicKeyHex: string
  signatureHex: string | null
  timestamp: string | null
  rawBody: string
  nowSeconds?: number
}): boolean {
  const { publicKeyHex, signatureHex, timestamp, rawBody } = opts
  if (!publicKeyHex || !signatureHex || !timestamp) return false
  if (!/^[0-9a-f]{64}$/i.test(publicKeyHex) || !/^[0-9a-f]{128}$/i.test(signatureHex)) return false
  const ts = Number(timestamp)
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000)
  if (!Number.isFinite(ts) || Math.abs(now - ts) > MAX_SKEW_SECONDS) return false
  try {
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyHex, 'hex')]),
      format: 'der',
      type: 'spki',
    })
    return verify(null, Buffer.from(timestamp + rawBody, 'utf8'), key, Buffer.from(signatureHex, 'hex'))
  } catch {
    return false
  }
}
