'use client'

import { useState, useEffect, useCallback } from 'react'
import { PollCard } from './PollCard'

interface Poll {
  id: string
  question: string
  description?: string
  options: string[]
  status: 'DRAFT' | 'OPEN' | 'CLOSED'
  closesAt?: string
  group?: {
    id: string
    name: string
    discordRoleName: string
    memberCount: number
  }
  results?: { optionIndex: number; count: number }[]
  voteCount?: number
}

export function PollsList() {
  const [polls, setPolls] = useState<Poll[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'open' | 'closed'>('all')

  const fetchPolls = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (filter === 'open') params.set('status', 'OPEN')
      if (filter === 'closed') params.set('status', 'CLOSED')

      const res = await fetch(`/api/governance/polls?${params}`)
      if (!res.ok) throw new Error('Failed to fetch polls')

      const data = await res.json()
      setPolls(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load polls')
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    fetchPolls()
  }, [fetchPolls])

  const openPolls = polls.filter(p => p.status === 'OPEN')
  const closedPolls = polls.filter(p => p.status === 'CLOSED')

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-48 bg-gray-800 rounded-xl animate-pulse" />
        <div className="h-48 bg-gray-800 rounded-xl animate-pulse" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6 bg-red-900/20 border border-red-800 rounded-xl text-center">
        <p className="text-red-400">{error}</p>
        <button
          onClick={fetchPolls}
          className="mt-2 text-sm text-gray-400 hover:text-white"
        >
          Try again
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Filter tabs */}
      <div className="flex gap-2">
        {(['all', 'open', 'closed'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-lg text-sm transition-colors ${
              filter === f
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
            {f === 'open' && openPolls.length > 0 && (
              <span className="ml-2 px-1.5 py-0.5 bg-green-600 rounded-full text-xs">
                {openPolls.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Polls list */}
      {polls.length === 0 ? (
        <div className="p-8 bg-gray-900 rounded-xl border border-gray-800 text-center">
          <p className="text-gray-400">No polls found</p>
          <p className="text-sm text-gray-500 mt-1">
            {filter === 'open' ? 'No active polls at the moment' :
             filter === 'closed' ? 'No closed polls yet' :
             'Polls will appear here once created'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {polls.map((poll) => (
            <PollCard
              key={poll.id}
              poll={poll}
              onVoted={fetchPolls}
            />
          ))}
        </div>
      )}
    </div>
  )
}
