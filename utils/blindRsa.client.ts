'use client'

import { RSABSSA } from '@cloudflare/blindrsa-ts'

// Use SHA-384 with PSS padding, randomized for extra security
const suite = RSABSSA.SHA384.PSS.Randomized()

// Import public key for blinding operations
export async function importPublicKey(pemKey: string) {
  return suite.importKey(pemKey, 'public')
}

// Prepare a message for blinding
export async function prepareMessage(message: string): Promise<Uint8Array> {
  return suite.prepare(new TextEncoder().encode(message))
}

// Blind a prepared message (returns blinded message and inverse for later unblinding)
export async function blind(
  publicKey: CryptoKey,
  preparedMessage: Uint8Array
): Promise<{ blindedMessage: Uint8Array; blindInverse: Uint8Array }> {
  const [blindedMessage, blindInverse] = await suite.blind(publicKey, preparedMessage)
  return { blindedMessage, blindInverse }
}

// Finalize (unblind) a signature to get the final valid signature
export async function finalize(
  publicKey: CryptoKey,
  preparedMessage: Uint8Array,
  blindedSignature: Uint8Array,
  blindInverse: Uint8Array
): Promise<Uint8Array> {
  return suite.finalize(publicKey, preparedMessage, blindedSignature, blindInverse)
}

// Convert Uint8Array to base64 string (browser-compatible)
export function toBase64(data: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i])
  }
  return btoa(binary)
}

// Convert base64 string to Uint8Array (browser-compatible)
export function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}
