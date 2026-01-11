import { ReactNode } from 'react'
import { GovernanceProviders } from './providers'

interface Props {
  children: ReactNode
}

export default function GovernanceLayout({ children }: Props) {
  return (
    <GovernanceProviders>
      <div className="min-h-screen bg-gray-950 text-white">
        <header className="border-b border-gray-800 px-6 py-4">
          <div className="max-w-6xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🍕</span>
              <a href="/governance" className="text-xl font-bold hover:text-gray-300">
                PizzaDAO Governance
              </a>
            </div>
            <a href="/" className="text-sm text-gray-400 hover:text-white">
              Back to Dashboard
            </a>
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-6 py-8">
          {children}
        </main>
      </div>
    </GovernanceProviders>
  )
}
