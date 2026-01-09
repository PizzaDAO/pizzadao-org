import { RSABSSA } from '@cloudflare/blindrsa-ts'

// Get suite instance - must call the function to get the actual suite
function getSuite() {
  return RSABSSA.SHA384.PSS.Randomized()
}

// Server-side: Import private key for signing
export async function importPrivateKey(pemKey: string): Promise<CryptoKey> {
  const suite = getSuite()
  // Convert PEM to ArrayBuffer
  const pemContents = pemKey
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '')
  const binaryString = atob(pemContents)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }

  return crypto.subtle.importKey(
    'pkcs8',
    bytes.buffer,
    { name: 'RSA-PSS', hash: 'SHA-384' },
    true,
    ['sign']
  )
}

// Server-side: Import public key for verification
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

// Server-side: Sign a blinded message
export async function blindSign(
  privateKey: CryptoKey,
  blindedMessage: Uint8Array
): Promise<Uint8Array> {
  const suite = getSuite()
  return suite.blindSign(privateKey, blindedMessage)
}

// Server-side: Verify an unblinded signature
export async function verify(
  publicKey: CryptoKey,
  signature: Uint8Array,
  message: Uint8Array
): Promise<boolean> {
  const suite = getSuite()
  try {
    await suite.verify(publicKey, signature, message)
    return true
  } catch {
    return false
  }
}

// Utility: Convert Uint8Array to base64 string
export function toBase64(data: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i])
  }
  return btoa(binary)
}

// Utility: Convert base64 string to Uint8Array
export function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

// Utility: Hash a token for storage (for double-vote prevention)
export async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(token)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = new Uint8Array(hashBuffer)
  let hex = ''
  for (let i = 0; i < hashArray.length; i++) {
    hex += hashArray[i].toString(16).padStart(2, '0')
  }
  return hex
}
