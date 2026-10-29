/**
 * Public-key fingerprint, computed the same way on the server and in the browser (WebCrypto only).
 * Shown on the proposal page and in the Discord post so members can check the key their browser blinds against.
 */
export const MIN_MODULUS_BITS = 2048

function pemToDer(pem: string): Uint8Array {
  const b64 = pem.replace(/-----(BEGIN|END) PUBLIC KEY-----/g, '').replace(/\s/g, '')
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** SHA-256 of the SPKI DER, first 128 bits, as 8 groups of 4 hex characters. */
export async function fingerprintOfPem(pem: string): Promise<string> {
  const der = pemToDer(pem)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', der.buffer.slice(der.byteOffset, der.byteOffset + der.byteLength) as ArrayBuffer))
  const hex = Array.from(digest.slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('')
  return hex.match(/.{4}/g)!.join(' ')
}

/** True when the key is an RSA key of at least MIN_MODULUS_BITS. */
export async function modulusOk(pem: string): Promise<boolean> {
  try {
    const der = pemToDer(pem)
    const key = await crypto.subtle.importKey('spki', der.buffer.slice(der.byteOffset, der.byteOffset + der.byteLength) as ArrayBuffer, { name: 'RSA-PSS', hash: 'SHA-384' }, true, ['verify'])
    return ((key.algorithm as RsaHashedKeyAlgorithm).modulusLength ?? 0) >= MIN_MODULUS_BITS
  } catch {
    return false
  }
}
