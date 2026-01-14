'use client'

import { useState, useEffect } from 'react'
import { TURTLE_ROLE_IDS, ROLE_ID_TO_TURTLE } from '@/app/ui/constants'

type PollOption = { id: string; label: string }
type PollResult = { pollId: string; optionId: string; tally: number }
type Poll = {
  id: string
  question: string
  options: PollOption[]
  requiredRoleId: string
  status: 'DRAFT' | 'OPEN' | 'CLOSED'
  createdAt: string
  results: PollResult[]
}

export default function AdminPollsPage() {
  const [polls, setPolls] = useState<Poll[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)

  // New poll form state
  const [showForm, setShowForm] = useState(false)
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState<string[]>(['', ''])
  const [requiredRole, setRequiredRole] = useState(TURTLE_ROLE_IDS.LEONARDO)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    checkAdminAndLoadPolls()
  }, [])

  async function checkAdminAndLoadPolls() {
    try {
      const res = await fetch('/api/polls')
      if (res.status === 401) {
        setError('Please log in first')
        setLoading(false)
        return
      }
      if (res.status === 403) {
        setError('You do not have admin access')
        setLoading(false)
        return
      }
      if (!res.ok) {
        throw new Error('Failed to load polls')
      }
      setIsAdmin(true)
      const data = await res.json()
      setPolls(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? (e as any)?.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  async function createPoll(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    try {
      const pollOptions = options
        .filter(o => o.trim())
        .map((label, i) => ({ id: `opt-${i}`, label: label.trim() }))

      const res = await fetch('/api/polls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          options: pollOptions,
          requiredRoleId: requiredRole,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to create poll')
      }

      const newPoll = await res.json()
      setPolls([newPoll, ...polls])
      setShowForm(false)
      setQuestion('')
      setOptions(['', ''])
    } catch (e: unknown) {
      alert(e instanceof Error ? (e as any)?.message : 'An error occurred')
    } finally {
      setCreating(false)
    }
  }

  async function updatePollStatus(pollId: string, status: 'OPEN' | 'CLOSED') {
    try {
      const res = await fetch(`/api/polls/${pollId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update poll')
      }

      const updated = await res.json()
      setPolls(polls.map(p => (p.id === pollId ? { ...p, ...updated } : p)))
    } catch (e: unknown) {
      alert(e instanceof Error ? (e as any)?.message : 'An error occurred')
    }
  }

  async function deletePoll(pollId: string) {
    if (!confirm('Are you sure you want to delete this poll?')) return

    try {
      const res = await fetch(`/api/polls/${pollId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete poll')
      }
      setPolls(polls.filter(p => p.id !== pollId))
    } catch (e: unknown) {
      alert(e instanceof Error ? (e as any)?.message : 'An error occurred')
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <p className="text-gray-600">Loading...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="bg-white p-6 rounded-lg shadow">
          <p className="text-red-600">{error}</p>
          <a href="/" className="text-blue-600 hover:underline mt-2 block">
            Go to home page
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100 py-8">
      <div className="max-w-4xl mx-auto px-4">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Poll Administration</h1>
          <button
            onClick={() => setShowForm(!showForm)}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            {showForm ? 'Cancel' : 'Create Poll'}
          </button>
        </div>

        {showForm && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <h2 className="text-lg font-semibold mb-4">New Poll</h2>
            <form onSubmit={createPoll}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Question
                </label>
                <input
                  type="text"
                  value={question}
                  onChange={e => setQuestion(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2"
                  placeholder="What would you like to ask?"
                  required
                />
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Options
                </label>
                {options.map((opt, i) => (
                  <div key={i} className="flex gap-2 mb-2">
                    <input
                      type="text"
                      value={opt}
                      onChange={e => {
                        const newOpts = [...options]
                        newOpts[i] = e.target.value
                        setOptions(newOpts)
                      }}
                      className="flex-1 border border-gray-300 rounded px-3 py-2"
                      placeholder={`Option ${i + 1}`}
                      required
                    />
                    {options.length > 2 && (
                      <button
                        type="button"
                        onClick={() => setOptions(options.filter((_, j) => j !== i))}
                        className="text-red-600 px-2"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setOptions([...options, ''])}
                  className="text-blue-600 text-sm hover:underline"
                >
                  + Add option
                </button>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Who can vote?
                </label>
                <select
                  value={requiredRole}
                  onChange={e => setRequiredRole(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2"
                >
                  {Object.entries(TURTLE_ROLE_IDS).map(([name, id]) => (
                    <option key={id} value={id}>
                      {name.charAt(0) + name.slice(1).toLowerCase()}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="submit"
                disabled={creating}
                className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:opacity-50"
              >
                {creating ? 'Creating...' : 'Create Poll'}
              </button>
            </form>
          </div>
        )}

        <div className="space-y-4">
          {polls.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-6 text-center text-gray-500">
              No polls yet. Create your first poll above.
            </div>
          ) : (
            polls.map(poll => (
              <div key={poll.id} className="bg-white rounded-lg shadow p-6">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h3 className="text-lg font-medium text-gray-900">{poll.question}</h3>
                    <p className="text-sm text-gray-500">
                      Eligible: {ROLE_ID_TO_TURTLE[poll.requiredRoleId] || poll.requiredRoleId}
                    </p>
                  </div>
                  <span
                    className={`px-2 py-1 rounded text-xs font-medium ${
                      poll.status === 'DRAFT'
                        ? 'bg-gray-100 text-gray-600'
                        : poll.status === 'OPEN'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-blue-100 text-blue-700'
                    }`}
                  >
                    {poll.status}
                  </span>
                </div>

                <div className="mb-4">
                  <p className="text-sm text-gray-600 mb-2">Options:</p>
                  <ul className="list-disc list-inside text-sm">
                    {(poll.options as PollOption[]).map(opt => (
                      <li key={opt.id}>
                        {opt.label}
                        {poll.status === 'CLOSED' && poll.results && (
                          <span className="text-gray-500 ml-2">
                            ({poll.results.find(r => r.optionId === opt.id)?.tally || 0} votes)
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="flex gap-2 text-sm">
                  {poll.status === 'DRAFT' && (
                    <>
                      <button
                        onClick={() => updatePollStatus(poll.id, 'OPEN')}
                        className="bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700"
                      >
                        Open Voting
                      </button>
                      <button
                        onClick={() => deletePoll(poll.id)}
                        className="bg-red-600 text-white px-3 py-1 rounded hover:bg-red-700"
                      >
                        Delete
                      </button>
                    </>
                  )}
                  {poll.status === 'OPEN' && (
                    <button
                      onClick={() => updatePollStatus(poll.id, 'CLOSED')}
                      className="bg-orange-600 text-white px-3 py-1 rounded hover:bg-orange-700"
                    >
                      Close Voting
                    </button>
                  )}
                  <a
                    href={`/vote/${poll.id}`}
                    className="bg-gray-600 text-white px-3 py-1 rounded hover:bg-gray-700"
                  >
                    View Poll
                  </a>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
