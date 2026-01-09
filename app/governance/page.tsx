'use client'

import dynamic from 'next/dynamic'

// Dynamically import the governance content to prevent SSR issues with Privy
const GovernanceContent = dynamic(
  () => import('./GovernanceContent'),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Governance</h1>
            <p className="text-gray-400 mt-1">
              Anonymous voting for PizzaDAO decisions
            </p>
          </div>
          <div className="w-32 h-10 bg-gray-800 rounded-lg animate-pulse" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            <div className="h-64 bg-gray-800 rounded-xl animate-pulse" />
          </div>
          <div>
            <div className="h-48 bg-gray-800 rounded-xl animate-pulse" />
          </div>
        </div>
      </div>
    ),
  }
)

export default function GovernancePage() {
  return <GovernanceContent />
}
