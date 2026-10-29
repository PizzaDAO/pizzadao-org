/**
 * Payee and attachment hashing (plans/host-fast-track.md D4).
 *
 * The app never stores a wallet address, bank number or payment handle. It keeps:
 *  - payeeHash: HMAC-SHA256 of the normalized reference, keyed with PAYMENTS_HASH_SECRET, so one
 *    payee used by several requesters can be spotted without being readable (or guessable, for
 *    short bank numbers) from the database;
 *  - payeeHint: a masked form, only enough for a reviewer to tell two payees apart.
 *
 * With no secret configured, hashPayee returns null: nothing derived from the payee is stored and
 * the shared-payee check is simply off. It never falls back to an unkeyed hash.
 */
import { createHash, createHmac } from 'node:crypto'

/** Lowercase, drop whitespace, dashes and a leading "mailto:"/"bank:" style prefix. */
export function normalizePayee(raw: string): string {
  return raw
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/^(wallet|address|bank|iban|paypal|venmo|zelle|mailto)\s*[:=]\s*/, '')
    .replace(/[\s\-_.,]/g, '')
}

export function hashPayee(raw: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const secret = env.PAYMENTS_HASH_SECRET?.trim()
  const norm = normalizePayee(raw)
  if (!secret || norm.length < 4) return null
  return createHmac('sha256', secret).update(`payee:v1:${norm}`).digest('hex')
}

/** "0x12...ab" for addresses; "...42" (last two characters only) for anything else. */
export function maskPayee(raw: string): string | null {
  const norm = normalizePayee(raw)
  if (norm.length < 4) return null
  if (/^0x[0-9a-f]{40}$/.test(norm)) return `${norm.slice(0, 4)}...${norm.slice(-2)}`
  return `...${norm.slice(-2)}`
}

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}
