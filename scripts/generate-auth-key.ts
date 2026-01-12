/**
 * One-time script to generate a P256 key pair for Privy server-side authorization.
 *
 * Run with: npx ts-node scripts/generate-auth-key.ts
 *
 * After running, add the PRIVY_AUTH_PRIVATE_KEY to your .env.local file.
 * The public key will be shown - you may need to register it with Privy.
 */

import { generateP256KeyPair } from '@privy-io/node'

async function main() {
  console.log('Generating P256 key pair for Privy authorization...\n')

  const keyPair = await generateP256KeyPair()

  console.log('=== IMPORTANT: Save these keys securely ===\n')

  console.log('PUBLIC KEY (for Privy registration):')
  console.log(keyPair.publicKey)
  console.log()

  console.log('PRIVATE KEY (add to .env.local as PRIVY_AUTH_PRIVATE_KEY):')
  console.log(keyPair.privateKey)
  console.log()

  console.log('Add this line to your .env.local:')
  console.log(`PRIVY_AUTH_PRIVATE_KEY="${keyPair.privateKey}"`)
  console.log()

  console.log('And this line for reference:')
  console.log(`PRIVY_AUTH_PUBLIC_KEY="${keyPair.publicKey}"`)
}

main().catch(console.error)
