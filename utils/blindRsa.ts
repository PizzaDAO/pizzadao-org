import { RSABSSA } from '@cloudflare/blindrsa-ts'

// Use SHA-384 with PSS padding, randomized for extra security
const suite = RSABSSA.SHA384.PSS.Randomized()

// Server-side: Import private key for signing
export async function importPrivateKey(pemKey: string) {
  return suite.importKey(pemKey, 'private')
}

// Server-side: Import public key for verification
export async function importPublicKey(pemKey: string) {
  return suite.importKey(pemKey, 'public')
}

// Server-side: Sign a blinded message
export async function blindSign(
  privateKey: CryptoKey,
  blindedMessage: Uint8Array
): Promise<Uint8Array> {
  return suite.blindSign(privateKey, blindedMessage)
}

// Server-side: Verify an unblinded signature
export async function verify(
  publicKey: CryptoKey,
  signature: Uint8Array,
  message: Uint8Array
): Promise<boolean> {
  try {
    await suite.verify(publicKey, signature, message)
    return true
  } catch {
    return false
  }
}

// Client-side: Prepare a message for blinding
export async function prepareMessage(message: string): Promise<Uint8Array> {
  return suite.prepare(new TextEncoder().encode(message))
}

// Client-side: Blind a prepared message
export async function blind(
  publicKey: CryptoKey,
  preparedMessage: Uint8Array
): Promise<{ blindedMessage: Uint8Array; blindInverse: Uint8Array }> {
  const [blindedMessage, blindInverse] = await suite.blind(publicKey, preparedMessage)
  return { blindedMessage, blindInverse }
}

// Client-side: Finalize (unblind) a signature
export async function finalize(
  publicKey: CryptoKey,
  preparedMessage: Uint8Array,
  blindedSignature: Uint8Array,
  blindInverse: Uint8Array
): Promise<Uint8Array> {
  return suite.finalize(publicKey, preparedMessage, blindedSignature, blindInverse)
}

// Utility: Convert Uint8Array to base64 string
export function toBase64(data: Uint8Array): string {
  return Buffer.from(data).toString('base64')
}

// Utility: Convert base64 string to Uint8Array
export function fromBase64(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, 'base64'))
}

// Utility: Hash a token for storage (for double-vote prevention)
export async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(token)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Buffer.from(hashBuffer).toString('hex')
}
