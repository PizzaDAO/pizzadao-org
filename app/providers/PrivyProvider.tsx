'use client'

import { PrivyProvider as BasePrivyProvider } from '@privy-io/react-auth'
import { ReactNode, createContext, useContext } from 'react'

interface Props {
  children: ReactNode
}

// Mock context for when Privy is not configured
interface MockPrivyContextType {
  ready: boolean
  authenticated: boolean
  user: null
  login: () => void
  logout: () => void
}

const MockPrivyContext = createContext<MockPrivyContextType>({
  ready: true,
  authenticated: false,
  user: null,
  login: () => {
    alert('Privy is not configured. Set NEXT_PUBLIC_PRIVY_APP_ID in .env.local')
  },
  logout: () => {},
})

export const useMockPrivy = () => useContext(MockPrivyContext)

function PrivyMockProvider({ children }: Props) {
  return (
    <MockPrivyContext.Provider
      value={{
        ready: true,
        authenticated: false,
        user: null,
        login: () => {
          alert('Privy is not configured.\n\nTo enable login:\n1. Create an app at dashboard.privy.io\n2. Set NEXT_PUBLIC_PRIVY_APP_ID in .env.local\n3. Restart the dev server')
        },
        logout: () => {},
      }}
    >
      {children}
    </MockPrivyContext.Provider>
  )
}

export function PrivyProvider({ children }: Props) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID

  // Check if Privy is properly configured
  const isValidAppId = appId && !appId.startsWith('placeholder')

  if (!isValidAppId) {
    // In development/build without Privy configured, show a placeholder UI
    return (
      <PrivyMockProvider>
        {children}
      </PrivyMockProvider>
    )
  }

  return (
    <BasePrivyProvider
      appId={appId}
      config={{
        // Login methods - Discord is primary
        loginMethods: ['discord'],

        // Appearance
        appearance: {
          theme: 'dark',
          accentColor: '#FF6B00', // Pizza orange
          logo: 'https://pizzadao.xyz/logo.png', // Update with actual logo
        },

        // Embedded wallets - created automatically on login
        embeddedWallets: {
          ethereum: {
            createOnLogin: 'users-without-wallets',
          },
        },

        // Legal
        legal: {
          termsAndConditionsUrl: 'https://pizzadao.xyz/terms',
          privacyPolicyUrl: 'https://pizzadao.xyz/privacy',
        },
      }}
    >
      {children}
    </BasePrivyProvider>
  )
}
