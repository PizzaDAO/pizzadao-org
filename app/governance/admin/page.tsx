'use client'

import { useState, useEffect } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import Link from 'next/link'

interface Poll {
  id: string
  question: string
  description?: string
  options: string[]
  status: string
  createdAt: string
  group?: { name: string; discordRoleName: string }
}

// Admin Discord IDs
const ADMIN_IDS = ['868617172757409822']

export default function GovernanceAdmin() {
  const { ready, authenticated, user } = usePrivy()
  const [polls, setPolls] = useState<Poll[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Form state
  const [showCreatePoll, setShowCreatePoll] = useState(false)
  const [pollForm, setPollForm] = useState({
    question: '',
    description: '',
    options: ['', ''],
  })
  const [submitting, setSubmitting] = useState(false)

  const discordAccount = user?.linkedAccounts?.find(a => a.type === 'discord_oauth')
  const discordId = discordAccount?.subject
  const isAdmin = discordId && ADMIN_IDS.includes(discordId)

  useEffect(() => {
    if (ready && authenticated && isAdmin) {
      fetchPolls()
    }
  }, [ready, authenticated, isAdmin])

  async function fetchPolls() {
    setLoading(true)
    try {
      const res = await fetch('/api/governance/polls')
      if (res.ok) setPolls(await res.json())
    } catch {
      setError('Failed to load polls')
    } finally {
      setLoading(false)
    }
  }

  async function createPoll(e: React.FormEvent) {
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
      fetchPolls()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create poll')
    } finally {
      setSubmitting(false)
    }
  }

  async function closePoll(pollId: string) {
    if (!confirm('Are you sure you want to close this poll?')) return

    try {
      const res = await fetch(`/api/governance/polls/${pollId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'CLOSED' }),
      })

      if (!res.ok) throw new Error('Failed to close poll')
      fetchPolls()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to close poll')
    }
  }

  if (!ready) {
    return <div className="p-8 text-center text-gray-400">Loading...</div>
  }

  if (!authenticated) {
    return (
      <div className="p-8 text-center">
        <p className="text-gray-400 mb-4">Please login to access admin</p>
        <Link href="/governance" className="text-blue-400 hover:underline">
          Go to Governance
        </Link>
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="p-8 text-center">
        <p className="text-red-400 mb-4">Access denied. Admin only.</p>
        <Link href="/governance" className="text-blue-400 hover:underline">
          Go to Governance
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-8 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Governance Admin</h1>
          <p className="text-sm text-gray-400">Polls are open to all leonardo role holders</p>
        </div>
        <Link href="/governance" className="text-blue-400 hover:underline text-sm">
          Back to Governance
        </Link>
      </div>

      {loading ? (
        <div className="text-gray-400">Loading...</div>
      ) : error ? (
        <div className="text-red-400">{error}</div>
      ) : (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Polls ({polls.length})</h2>
            <button
              onClick={() => setShowCreatePoll(!showCreatePoll)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm"
            >
              {showCreatePoll ? 'Cancel' : 'Create Poll'}
            </button>
          </div>

          {showCreatePoll && (
            <form onSubmit={createPoll} className="p-4 bg-gray-800 rounded-lg space-y-4">
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

          <div className="grid gap-4">
            {polls.length === 0 ? (
              <p className="text-gray-500">No polls yet. Create one!</p>
            ) : (
              polls.map((poll) => (
                <div key={poll.id} className="p-4 bg-gray-800 rounded-lg">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <h3 className="font-medium">{poll.question}</h3>
                      {poll.description && (
                        <p className="text-sm text-gray-400 mt-1">{poll.description}</p>
                      )}
                      <div className="flex flex-wrap gap-2 mt-2">
                        {poll.options.map((opt, i) => (
                          <span key={i} className="px-2 py-1 bg-gray-700 rounded text-xs">
                            {opt}
                          </span>
                        ))}
                      </div>
                      <p className="text-xs text-gray-500 mt-2">
                        Created {new Date(poll.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-1 rounded text-xs ${
                        poll.status === 'OPEN' ? 'bg-green-600' :
                        poll.status === 'CLOSED' ? 'bg-gray-600' : 'bg-yellow-600'
                      }`}>
                        {poll.status}
                      </span>
                      {poll.status === 'OPEN' && (
                        <button
                          onClick={() => closePoll(poll.id)}
                          className="px-2 py-1 bg-red-600 hover:bg-red-700 rounded text-xs"
                        >
                          Close
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      )}
    </div>
  )
}
