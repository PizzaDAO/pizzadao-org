import { Identity } from '@semaphore-protocol/core'

const IDENTITY_STORAGE_KEY = 'pizzadao_semaphore_identity'

/**
 * Generate a deterministic Semaphore identity from a secret.
 * The secret should be derived from the user's wallet signature.
 */
export function generateIdentity(secret: string): Identity {
  return new Identity(secret)
}

/**
 * Generate identity from wallet signature.
 * This creates a deterministic identity that can be recreated
 * as long as the user has access to their wallet.
 */
export async function generateIdentityFromWallet(
  signMessage: (message: string) => Promise<string>
): Promise<Identity> {
  // Use a fixed message that the user signs to derive their identity
  const message = 'Sign this message to generate your PizzaDAO voting identity. This signature will not be stored.'

  const signature = await signMessage(message)

  // The signature becomes the secret for the identity
  return generateIdentity(signature)
}

/**
 * Store identity commitment in local storage.
 * We only store the commitment (public), not the full identity.
 */
export function storeIdentityCommitment(commitment: bigint): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(IDENTITY_STORAGE_KEY, commitment.toString())
  }
}

/**
 * Get stored identity commitment from local storage.
 */
export function getStoredCommitment(): bigint | null {
  if (typeof window === 'undefined') return null

  const stored = localStorage.getItem(IDENTITY_STORAGE_KEY)
  return stored ? BigInt(stored) : null
}

/**
 * Clear stored identity commitment.
 */
export function clearStoredCommitment(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(IDENTITY_STORAGE_KEY)
  }
}

/**
 * Check if user has a stored identity.
 */
export function hasStoredIdentity(): boolean {
  return getStoredCommitment() !== null
}
