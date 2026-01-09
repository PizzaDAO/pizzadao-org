import { NextResponse } from 'next/server'
import { RSABSSA } from '@cloudflare/blindrsa-ts'

// Simple test to verify RSA keys and blind signature flow works
export async function GET() {
  const publicKeyPem = process.env.RSA_PUBLIC_KEY_PEM
  const privateKeyPem = process.env.RSA_PRIVATE_KEY_PEM

  if (!publicKeyPem || !privateKeyPem) {
    return NextResponse.json({ error: 'Missing RSA keys' }, { status: 500 })
  }

  try {
    const suite = RSABSSA.SHA384.PSS.Randomized()

    // Convert PEM to ArrayBuffer
    function pemToArrayBuffer(pem: string, type: 'public' | 'private'): ArrayBuffer {
      const header = type === 'public' ? '-----BEGIN PUBLIC KEY-----' : '-----BEGIN PRIVATE KEY-----'
      const footer = type === 'public' ? '-----END PUBLIC KEY-----' : '-----END PRIVATE KEY-----'
      const pemContents = pem.replace(header, '').replace(footer, '').replace(/\s/g, '')
      const binaryString = atob(pemContents)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }
      return bytes.buffer
    }

    // Import keys
    const publicKey = await crypto.subtle.importKey(
      'spki',
      pemToArrayBuffer(publicKeyPem, 'public'),
      { name: 'RSA-PSS', hash: 'SHA-384' },
      true,
      ['verify']
    )

    const privateKey = await crypto.subtle.importKey(
      'pkcs8',
      pemToArrayBuffer(privateKeyPem, 'private'),
      { name: 'RSA-PSS', hash: 'SHA-384' },
      true,
      ['sign']
    )

    // Test the full blind signature flow
    const testMessage = 'test-message-' + Date.now()
    const msgBytes = new TextEncoder().encode(testMessage)

    // 1. Prepare message
    const preparedMsg = suite.prepare(msgBytes)
    console.log('[test-rsa] Prepared message length:', preparedMsg.length)

    // 2. Blind
    const { blindedMsg, inv } = await suite.blind(publicKey, preparedMsg)
    console.log('[test-rsa] Blinded message length:', blindedMsg.length)

    // 3. Server signs
    const blindSig = await suite.blindSign(privateKey, blindedMsg)
    console.log('[test-rsa] Blind signature length:', blindSig.length)

    // 4. Finalize (unblind)
    const finalSig = await suite.finalize(publicKey, preparedMsg, blindSig, inv)
    console.log('[test-rsa] Final signature length:', finalSig.length)

    // 5. Verify - try both raw message and prepared message
    const isValidRaw = await suite.verify(publicKey, finalSig, msgBytes)
    console.log('[test-rsa] Verification with raw message:', isValidRaw)

    // Try direct Web Crypto verify with prepared message
    const isValidPrepared = await crypto.subtle.verify(
      { name: 'RSA-PSS', saltLength: 48 }, // SHA-384 = 48 bytes
      publicKey,
      finalSig,
      preparedMsg
    )
    console.log('[test-rsa] Verification with prepared message (direct):', isValidPrepared)

    return NextResponse.json({
      success: true,
      testMessage,
      preparedMsgLength: preparedMsg.length,
      blindedMsgLength: blindedMsg.length,
      blindSigLength: blindSig.length,
      finalSigLength: finalSig.length,
      isValidRaw,
      isValidPrepared,
    })
  } catch (e: unknown) {
    console.error('[test-rsa] Error:', e)
    return NextResponse.json({
      error: e instanceof Error ? e.message : 'Unknown error',
      stack: e instanceof Error ? e.stack : undefined,
    }, { status: 500 })
  }
}
