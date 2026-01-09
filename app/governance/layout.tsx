import { PrivyProvider } from '../providers/PrivyProvider'
import { ReactNode } from 'react'
import { HeaderNav } from './components/HeaderNav'

interface Props {
  children: ReactNode
}

export default function GovernanceLayout({ children }: Props) {
  return (
    <PrivyProvider>
      <div className="min-h-screen bg-gray-950 text-white">
        <header className="border-b border-gray-800 px-6 py-4">
          <div className="max-w-6xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🍕</span>
              <h1 className="text-xl font-bold">PizzaDAO Governance</h1>
            </div>
            <HeaderNav />
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-6 py-8">
          {children}
        </main>
      </div>
    </PrivyProvider>
  )
}
