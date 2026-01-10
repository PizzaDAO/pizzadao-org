'use client'

import { usePrivy } from '@privy-io/react-auth'
import { LoginButton } from './components/LoginButton'
import { UserInfo } from './components/UserInfo'
import { PollsList } from './components/PollsList'

export default function GovernanceContent() {
  const { ready, authenticated } = usePrivy()

  return (
    <div className="space-y-8">
      {/* Header with login */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Governance</h1>
          <p className="text-gray-400 mt-1">
            Anonymous voting for PizzaDAO decisions
          </p>
        </div>
        <LoginButton />
      </div>

      {/* Main content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Polls section */}
        <div className="lg:col-span-2 space-y-6">
          <h2 className="text-xl font-semibold">Polls</h2>

          {!ready ? (
            <div className="animate-pulse space-y-4">
              <div className="h-32 bg-gray-800 rounded-xl"></div>
              <div className="h-32 bg-gray-800 rounded-xl"></div>
            </div>
          ) : !authenticated ? (
            <div className="p-8 bg-gray-900 rounded-xl border border-gray-800 text-center">
              <p className="text-gray-400 mb-4">
                Login with Discord to view and vote on polls
              </p>
              <LoginButton />
            </div>
          ) : (
            <PollsList />
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <UserInfo />

          {/* Info card */}
          <div className="p-6 bg-gray-900 rounded-xl border border-gray-800">
            <h3 className="font-semibold mb-3">How Voting Works</h3>
            <ul className="space-y-2 text-sm text-gray-400">
              <li className="flex items-start gap-2">
                <span className="text-green-400">✓</span>
                Your vote is anonymous
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-400">✓</span>
                You can change your vote anytime
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-400">✓</span>
                Results shown after poll closes
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-400">✓</span>
                Verified on-chain
              </li>
            </ul>
          </div>

          {/* Phase indicator */}
          <div className="p-6 bg-gray-900 rounded-xl border border-gray-800">
            <h3 className="font-semibold mb-3">Development Status</h3>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-green-400 rounded-full"></span>
                <span>Phase 1: Privy Integration</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-green-400 rounded-full"></span>
                <span>Phase 2: Semaphore (Anonymous)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-gray-600 rounded-full"></span>
                <span className="text-gray-500">Phase 3: MACI (Anti-coercion)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-gray-600 rounded-full"></span>
                <span className="text-gray-500">Phase 4: Delegation</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-gray-600 rounded-full"></span>
                <span className="text-gray-500">Phase 5: Liquid Democracy</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
