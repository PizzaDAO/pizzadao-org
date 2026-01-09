'use client'

import { usePrivy, useWallets } from '@privy-io/react-auth'

// Re-export Privy hooks with additional safety
// These will throw if used outside PrivyProvider, but that's expected

export function useAuth() {
  const privy = usePrivy()
  const { wallets } = useWallets()

  const embeddedWallet = wallets?.find(w => w.walletClientType === 'privy')

  return {
    ready: privy.ready,
    authenticated: privy.authenticated,
    user: privy.user,
    login: privy.login,
    logout: privy.logout,
    wallet: embeddedWallet,
    discordUser: privy.user?.discord,
  }
}

export { usePrivy, useWallets }
