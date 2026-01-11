'use client'

import { useEffect, useState, useCallback } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { useSemaphore } from './hooks/useSemaphore'
import { PollsList } from './components/PollsList'
import Link from 'next/link'

// Admin Discord IDs
const ADMIN_IDS = ['868617172757409822']

export default function GovernanceContent() {
  const { ready, authenticated, user, login, logout } = usePrivy()
  const [isSyncing, setIsSyncing] = useState(false)
  const [showCreatePoll, setShowCreatePoll] = useState(false)
  const [pollForm, setPollForm] = useState({ question: '', description: '', options: ['', ''] })
  const [submitting, setSubmitting] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  // Get Discord ID from Privy user object
  const discordAccount = user?.linkedAccounts?.find(a => a.type === 'discord_oauth')
  const discordId = discordAccount?.subject
  const discordUsername = discordAccount?.username
  const isAdmin = discordId && ADMIN_IDS.includes(discordId)

  const { hasStoredIdentity, isGeneratingIdentity, identityError, generateIdentity, isWaitingForWallet } = useSemaphore(discordId)

  // Auto-sync user when they have identity
  useEffect(() => {
    if (authenticated && hasStoredIdentity && discordId && !isSyncing) {
      setIsSyncing(true)
      fetch('/api/governance/sync-me', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discordId }),
      }).finally(() => setIsSyncing(false))
    }
  }, [authenticated, hasStoredIdentity, discordId])

  // Handle logout
  const handleLogout = async () => {
    await logout()
  }

  // Create poll
  const createPoll = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!discordId) return

    setSubmitting(true)
    try {
      const res = await fetch('/api/governance/polls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: pollForm.question,
          description: pollForm.description || undefined,
          options: pollForm.options.filter(o => o.trim()),
          createdBy: discordId,
          status: 'OPEN',
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to create poll')
      }

      setShowCreatePoll(false)
      setPollForm({ question: '', description: '', options: ['', ''] })
      setRefreshKey(k => k + 1) // Trigger polls refresh
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create poll')
    } finally {
      setSubmitting(false)
    }
  }, [discordId, pollForm])

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
        {!ready ? (
          <div className="w-32 h-10 bg-gray-800 rounded-lg animate-pulse" />
        ) : authenticated ? (
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-400">
              {discordUsername || 'Connected'}
            </span>
            {isAdmin && (
              <Link
                href="/governance/admin"
                className="px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm transition-colors"
              >
                Admin
              </Link>
            )}
            <button
              onClick={handleLogout}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition-colors"
            >
              Logout
            </button>
          </div>
        ) : (
          <button
            onClick={login}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-lg text-sm transition-colors"
          >
            Login with Discord
          </button>
        )}
      </div>

      {/* Main content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Polls section */}
        <div className="lg:col-span-2 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Polls</h2>
            {isAdmin && hasStoredIdentity && (
              <button
                onClick={() => setShowCreatePoll(!showCreatePoll)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm transition-colors"
              >
                {showCreatePoll ? 'Cancel' : 'Create Poll'}
              </button>
            )}
          </div>

          {/* Create Poll Form */}
          {showCreatePoll && isAdmin && (
            <form onSubmit={createPoll} className="p-4 bg-gray-800 rounded-xl space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Question</label>
                <input
                  type="text"
                  value={pollForm.question}
                  onChange={(e) => setPollForm({ ...pollForm, question: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 rounded border border-gray-600 focus:border-blue-500 outline-none"
                  placeholder="What should we decide?"
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Description (optional)</label>
                <textarea
                  value={pollForm.description}
                  onChange={(e) => setPollForm({ ...pollForm, description: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 rounded border border-gray-600 focus:border-blue-500 outline-none"
                  placeholder="Additional context..."
                  rows={2}
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Options</label>
                {pollForm.options.map((opt, i) => (
                  <div key={i} className="flex gap-2 mb-2">
                    <input
                      type="text"
                      value={opt}
                      onChange={(e) => {
                        const newOptions = [...pollForm.options]
                        newOptions[i] = e.target.value
                        setPollForm({ ...pollForm, options: newOptions })
                      }}
                      className="flex-1 px-3 py-2 bg-gray-700 rounded border border-gray-600 focus:border-blue-500 outline-none"
                      placeholder={`Option ${i + 1}`}
                      required={i < 2}
                    />
                    {i >= 2 && (
                      <button
                        type="button"
                        onClick={() => {
                          const newOptions = pollForm.options.filter((_, j) => j !== i)
                          setPollForm({ ...pollForm, options: newOptions })
                        }}
                        className="px-3 py-2 bg-red-600 hover:bg-red-700 rounded"
                      >
                        X
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setPollForm({ ...pollForm, options: [...pollForm.options, ''] })}
                  className="text-sm text-blue-400 hover:underline"
                >
                  + Add option
                </button>
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg disabled:opacity-50"
              >
                {submitting ? 'Creating...' : 'Create Poll'}
              </button>
            </form>
          )}

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
              <button
                onClick={login}
                className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
              >
                Login with Discord
              </button>
            </div>
          ) : !discordId ? (
            <div className="p-8 bg-gray-900 rounded-xl border border-yellow-800 text-center">
              <p className="text-yellow-400 mb-4">
                Please link your Discord account to vote
              </p>
              <button
                onClick={login}
                className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
              >
                Link Discord
              </button>
            </div>
          ) : isGeneratingIdentity ? (
            <div className="p-8 bg-gray-900 rounded-xl border border-gray-800 text-center">
              <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-4" />
              <p className="text-gray-400">Setting up your anonymous voting identity...</p>
              <p className="text-gray-500 text-sm mt-2">This only happens once</p>
            </div>
          ) : identityError ? (
            <div className="p-8 bg-gray-900 rounded-xl border border-red-800 text-center">
              <p className="text-red-400 mb-4">{identityError}</p>
              <button
                onClick={generateIdentity}
                className="px-6 py-2 bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
              >
                Try Again
              </button>
            </div>
          ) : isWaitingForWallet ? (
            <div className="p-8 bg-gray-900 rounded-xl border border-gray-800 text-center">
              <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-4" />
              <p className="text-gray-400">Setting up your secure wallet...</p>
              <p className="text-gray-500 text-sm mt-2">This may take a moment for new users</p>
              <button
                onClick={generateIdentity}
                className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm transition-colors"
              >
                Continue Setup
              </button>
            </div>
          ) : !hasStoredIdentity ? (
            <div className="p-8 bg-gray-900 rounded-xl border border-gray-800 text-center">
              <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-4" />
              <p className="text-gray-400">Preparing voting system...</p>
              <button
                onClick={generateIdentity}
                className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm transition-colors"
              >
                Set Up Voting
              </button>
            </div>
          ) : (
            <PollsList key={refreshKey} />
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* User info */}
          {authenticated && (
            <div className="p-6 bg-gray-900 rounded-xl border border-gray-800">
              <h3 className="font-semibold mb-3">Your Account</h3>
              <p className="text-gray-400 text-sm">
                Logged in as <span className="text-white">{discordUsername || 'User'}</span>
              </p>
              {hasStoredIdentity && (
                <p className="text-green-400 text-sm mt-2">
                  Voting identity active
                </p>
              )}
              {isGeneratingIdentity && (
                <p className="text-blue-400 text-sm mt-2">
                  Creating voting identity...
                </p>
              )}
            </div>
          )}

          {/* Info card */}
          <div className="p-6 bg-gray-900 rounded-xl border border-gray-800">
            <h3 className="font-semibold mb-3">How Voting Works</h3>
            <ul className="space-y-2 text-sm text-gray-400">
              <li className="flex items-start gap-2">
                <span className="text-green-400">1.</span>
                Login with Discord
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-400">2.</span>
                View polls you&apos;re eligible to vote on
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-400">3.</span>
                Select your choice and vote anonymously
              </li>
            </ul>
          </div>

          {/* Privacy info */}
          <div className="p-6 bg-gray-900 rounded-xl border border-gray-800">
            <h3 className="font-semibold mb-3">Privacy Guarantees</h3>
            <ul className="space-y-2 text-sm text-gray-400">
              <li className="flex items-start gap-2">
                <span className="text-green-400">&#x2713;</span>
                Your vote is anonymous
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-400">&#x2713;</span>
                Zero-knowledge proofs protect your identity
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-400">&#x2713;</span>
                Results shown after poll closes
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-400">&#x2713;</span>
                One vote per person (cryptographically enforced)
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
