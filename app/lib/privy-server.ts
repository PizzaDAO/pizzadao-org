// Server-side Privy utilities
// NOTE: Batch identity creation is temporarily disabled pending Privy SDK v0.7 migration
// Users create their identities client-side on first login

/**
 * Placeholder for server-side identity creation
 * This will be implemented when we migrate to the new Privy SDK API
 */
export async function createIdentityForDiscordUser(_discordId: string): Promise<{
  success: boolean
  commitment?: string
  error?: string
  alreadyExists?: boolean
}> {
  return {
    success: false,
    error: 'Server-side identity creation is not yet implemented. Users should create identities via the UI.'
  }
}

/**
 * Placeholder for batch identity creation
 */
export async function batchCreateIdentities(
  _discordIds: string[],
  _onProgress?: (completed: number, total: number, current: string) => void
): Promise<{
  successful: number
  failed: number
  alreadyExisted: number
  results: Array<{ discordId: string; success: boolean; commitment?: string; error?: string }>
}> {
  return {
    successful: 0,
    failed: 0,
    alreadyExisted: 0,
    results: []
  }
}
