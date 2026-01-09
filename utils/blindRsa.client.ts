'use client'

import { RSABSSA } from '@cloudflare/blindrsa-ts'

// Get suite instance
function getSuite() {
  return RSABSSA.SHA384.PSS.Randomized()
}

// Import public key for blinding operations
export async function importPublicKey(pemKey: string): Promise<CryptoKey> {
  // Convert PEM to ArrayBuffer
  const pemContents = pemKey
    .replace(/-----BEGIN PUBLIC KEY-----/, '')
    .replace(/-----END PUBLIC KEY-----/, '')
    .replace(/\s/g, '')
  const binaryString = atob(pemContents)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }

  return crypto.subtle.importKey(
    'spki',
    bytes.buffer,
    { name: 'RSA-PSS', hash: 'SHA-384' },
    true,
    ['verify']
  )
}

// Prepare a message for blinding
export async function prepareMessage(message: string): Promise<Uint8Array> {
  const suite = getSuite()
  return suite.prepare(new TextEncoder().encode(message))
}

// Blind a prepared message (returns blinded message and inverse for later unblinding)
export async function blind(
  publicKey: CryptoKey,
  preparedMessage: Uint8Array
): Promise<{ blindedMessage: Uint8Array; blindInverse: Uint8Array }> {
  const suite = getSuite()
  const result = await suite.blind(publicKey, preparedMessage)
  return {
    blindedMessage: result.blindedMsg,
    blindInverse: result.inv,
  }
}

// Finalize (unblind) a signature to get the final valid signature
export async function finalize(
  publicKey: CryptoKey,
  preparedMessage: Uint8Array,
  blindedSignature: Uint8Array,
  blindInverse: Uint8Array
): Promise<Uint8Array> {
  const suite = getSuite()
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
