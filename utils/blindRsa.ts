import { RSABSSA } from '@cloudflare/blindrsa-ts'

// Get suite instance
function getSuite() {
  return RSABSSA.SHA384.PSS.Randomized()
}

// Convert PEM to ArrayBuffer
function pemToArrayBuffer(pem: string, type: 'public' | 'private'): ArrayBuffer {
  const header = type === 'public' ? '-----BEGIN PUBLIC KEY-----' : '-----BEGIN PRIVATE KEY-----'
  const footer = type === 'public' ? '-----END PUBLIC KEY-----' : '-----END PRIVATE KEY-----'

  const pemContents = pem
    .replace(header, '')
    .replace(footer, '')
    .replace(/\s/g, '')

  const binaryString = atob(pemContents)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes.buffer
}

// Server-side: Import private key for signing
export async function importPrivateKey(pemKey: string): Promise<CryptoKey> {
  const keyData = pemToArrayBuffer(pemKey, 'private')
  return crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'RSA-PSS', hash: 'SHA-384' },
    true,
    ['sign']
  )
}

// Server-side: Import public key for verification
export async function importPublicKey(pemKey: string): Promise<CryptoKey> {
  const keyData = pemToArrayBuffer(pemKey, 'public')
  return crypto.subtle.importKey(
    'spki',
    keyData,
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
    return await suite.verify(publicKey, signature, message)
  } catch {
    return false
  }
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
