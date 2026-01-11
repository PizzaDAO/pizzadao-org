'use client'

import { ReactNode } from 'react'
import { PrivyProvider } from '@privy-io/react-auth'

interface Props {
  children: ReactNode
}

export function GovernanceProviders({ children }: Props) {
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
      config={{
        appearance: {
          theme: 'dark',
          accentColor: '#6366f1',
        },
        embeddedWallets: {
          createOnLogin: 'users-without-wallets',
        },
        loginMethods: ['discord'],
      }}
    >
      {children}
    </PrivyProvider>
  )
}
