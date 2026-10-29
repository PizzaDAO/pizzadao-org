/**
 * Wallet-backed ballot backup (browser and tests; WebCrypto only).
 *
 * The member signs a fixed message with their wallet; the SIGNATURE (which never leaves the browser) is the input
 * to HKDF, which gives an AES-GCM key. Only the ciphertext goes to the server. On a new device, connecting any
 * wallet that can produce the same signature, signing the same message and fetching the ciphertext recovers the ballot.
 *
 * Caveat: only wallets with deterministic signatures (ordinary EOAs, RFC 6979) can restore. Smart-contract wallets
 * may sign differently each time; the UI signs twice and refuses to back up when the two signatures differ.
 */

export interface BackupPayload {
  /** The ballot token, its prepared message and unblinded signature: all that is needed to vote. Never the choice. */
  token: string
  preparedMessage: string
  signature: string
}

/**
 * The plaintext is padded to this many bytes before encryption, so every backup has the same length and the server can
 * require exactly that length (the size reveals nothing about the contents, and it bounds what can be stored).
 */
export const BACKUP_PLAINTEXT_BYTES = 2048
/** base64url length (no padding) of iv (12) + padded plaintext + GCM tag (16). */
export const BACKUP_BLOB_LENGTH = Math.ceil(((12 + BACKUP_PLAINTEXT_BYTES + 16) * 4) / 3)

export const backupMessage = (proposalId: string) => `PizzaDAO ballot backup v1 – ${proposalId}`

const enc = new TextEncoder()

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex
  if (h.length < 2 || h.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(h)) throw new Error('bad signature')
  const out = new Uint8Array(h.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16)
  return out
}

function b64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function unb64(s: string): Uint8Array {
  const clean = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(clean + '='.repeat((4 - (clean.length % 4)) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function deriveKey(walletSignatureHex: string, proposalId: string): Promise<CryptoKey> {
  const sig = hexToBytes(walletSignatureHex)
  const ikm = await crypto.subtle.importKey('raw', sig.buffer.slice(sig.byteOffset, sig.byteOffset + sig.byteLength) as ArrayBuffer, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('pizzadao-ballot-backup-v1'), info: enc.encode(proposalId) },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** base64url(iv || ciphertext). Safe to send to the server: it holds no key material. */
export async function encryptBallot(walletSignatureHex: string, proposalId: string, payload: BackupPayload): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  // Only the three credentials go in, whatever else the caller's object carries.
  const json = enc.encode(JSON.stringify({ token: payload.token, preparedMessage: payload.preparedMessage, signature: payload.signature }))
  if (json.length > BACKUP_PLAINTEXT_BYTES) throw new Error('backup payload too large')
  const padded = new Uint8Array(BACKUP_PLAINTEXT_BYTES).fill(0x20) // trailing spaces: valid JSON whitespace
  padded.set(json)
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(proposalId) }, await deriveKey(walletSignatureHex, proposalId), padded),
  )
  const out = new Uint8Array(iv.length + ct.length)
  out.set(iv)
  out.set(ct, iv.length)
  return b64(out)
}

/** Null when the blob is not decryptable with this signature (wrong wallet, wrong proposal, tampered). */
export async function decryptBallot(walletSignatureHex: string, proposalId: string, blob: string): Promise<BackupPayload | null> {
  try {
    const raw = unb64(blob)
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: raw.slice(0, 12), additionalData: enc.encode(proposalId) },
      await deriveKey(walletSignatureHex, proposalId),
      raw.slice(12),
    )
    const o = JSON.parse(new TextDecoder().decode(pt)) as BackupPayload
    if (typeof o.token !== 'string' || typeof o.preparedMessage !== 'string' || typeof o.signature !== 'string') return null
    if (!o.token.startsWith(`proposal-${proposalId}-`)) return null
    return { token: o.token, preparedMessage: o.preparedMessage, signature: o.signature }
  } catch {
    return null
  }
}
