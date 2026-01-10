'use client'

import { useState } from 'react'
import { Group } from '@semaphore-protocol/core'
import { useSemaphore } from '../hooks/useSemaphore'

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
  hasVoted?: boolean
}

interface PollCardProps {
  poll: Poll
  onVoted?: () => void
}

export function PollCard({ poll, onVoted }: PollCardProps) {
  const { identity, commitment, generateIdentity, isGeneratingIdentity, vote, isVoting } = useSemaphore()
  const [selectedOption, setSelectedOption] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isJoiningGroup, setIsJoiningGroup] = useState(false)
  const [hasJoinedGroup, setHasJoinedGroup] = useState(false)

  const isOpen = poll.status === 'OPEN'
  const isClosed = poll.status === 'CLOSED'

  // Format time remaining
  const getTimeRemaining = () => {
    if (!poll.closesAt) return null
    const closes = new Date(poll.closesAt)
    const now = new Date()
    const diff = closes.getTime() - now.getTime()

    if (diff <= 0) return 'Ended'

    const days = Math.floor(diff / (1000 * 60 * 60 * 24))
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))

    if (days > 0) return `${days}d ${hours}h remaining`
    return `${hours}h remaining`
  }

  // Join the Semaphore group
  const handleJoinGroup = async () => {
    if (!commitment || !poll.group) return

    setIsJoiningGroup(true)
    setError(null)

    try {
      const res = await fetch('/api/governance/groups/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupId: poll.group.id,
          commitment: commitment.toString(),
          discordId: 'user', // TODO: Get from session
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        if (data.error === 'Already a member of this group') {
          setHasJoinedGroup(true)
          return
        }
        throw new Error(data.error || 'Failed to join group')
      }

      setHasJoinedGroup(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join group')
    } finally {
      setIsJoiningGroup(false)
    }
  }

  // Cast vote
  const handleVote = async () => {
    if (selectedOption === null || !identity || !poll.group) return

    setError(null)

    try {
      // Fetch group members to reconstruct the group
      const groupRes = await fetch(`/api/governance/groups/${poll.group.id}`)
      if (!groupRes.ok) throw new Error('Failed to fetch group')
      const groupData = await groupRes.json()

      // Reconstruct Semaphore group
      const semaphoreGroup = new Group()
      for (const member of groupData.members) {
        semaphoreGroup.addMember(BigInt(member.commitment))
      }

      // Generate proof and vote
      const { proof } = await vote(semaphoreGroup, poll.id, selectedOption)

      // Submit vote to API
      const voteRes = await fetch('/api/governance/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pollId: poll.id,
          proof: {
            merkleTreeDepth: proof.merkleTreeDepth,
            merkleTreeRoot: proof.merkleTreeRoot.toString(),
            nullifier: proof.nullifier.toString(),
            message: proof.message.toString(),
            scope: proof.scope.toString(),
            points: proof.points,
          },
        }),
      })

      if (!voteRes.ok) {
        const data = await voteRes.json()
        throw new Error(data.error || 'Failed to submit vote')
      }

      setSuccess(true)
      onVoted?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to vote')
    }
  }

  // Calculate result percentages
  const getResultPercentage = (optionIndex: number) => {
    if (!poll.results || !poll.voteCount) return 0
    const result = poll.results.find(r => r.optionIndex === optionIndex)
    return result ? Math.round((result.count / poll.voteCount) * 100) : 0
  }

  return (
    <div className="p-6 bg-gray-900 rounded-xl border border-gray-800">
      {/* Status badge */}
      <div className="flex items-center justify-between mb-4">
        <span className={`px-2 py-1 text-xs rounded-full ${
          isOpen ? 'bg-green-900 text-green-400' :
          isClosed ? 'bg-gray-700 text-gray-400' :
          'bg-yellow-900 text-yellow-400'
        }`}>
          {poll.status}
        </span>
        {poll.closesAt && (
          <span className="text-sm text-gray-400">{getTimeRemaining()}</span>
        )}
      </div>

      {/* Question */}
      <h3 className="text-lg font-semibold mb-2">{poll.question}</h3>
      {poll.description && (
        <p className="text-gray-400 text-sm mb-4">{poll.description}</p>
      )}

      {/* Group info */}
      {poll.group && (
        <p className="text-xs text-gray-500 mb-4">
          Voting group: {poll.group.discordRoleName} ({poll.group.memberCount} members)
        </p>
      )}

      {/* Options */}
      <div className="space-y-2">
        {poll.options.map((option, index) => (
          <div key={index} className="relative">
            {isClosed && poll.results ? (
              // Show results for closed polls
              <div className="p-3 bg-gray-800 rounded-lg">
                <div className="flex justify-between mb-1">
                  <span>{option}</span>
                  <span className="text-gray-400">{getResultPercentage(index)}%</span>
                </div>
                <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all"
                    style={{ width: `${getResultPercentage(index)}%` }}
                  />
                </div>
              </div>
            ) : isOpen && !success ? (
              // Voting buttons for open polls
              <button
                onClick={() => setSelectedOption(index)}
                disabled={!identity || isVoting}
                className={`w-full p-3 rounded-lg text-left transition-colors ${
                  selectedOption === index
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 hover:bg-gray-700'
                } ${!identity ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {option}
              </button>
            ) : (
              // Static display
              <div className="p-3 bg-gray-800 rounded-lg">{option}</div>
            )}
          </div>
        ))}
      </div>

      {/* Vote count for closed polls */}
      {isClosed && poll.voteCount !== undefined && (
        <p className="text-sm text-gray-400 mt-4">
          Total votes: {poll.voteCount}
        </p>
      )}

      {/* Voting flow */}
      {isOpen && !success && (
        <div className="mt-4 space-y-3">
          {error && (
            <p className="text-red-400 text-sm">{error}</p>
          )}

          {!identity ? (
            // Step 1: Generate identity
            <button
              onClick={generateIdentity}
              disabled={isGeneratingIdentity}
              className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 rounded-lg transition-colors"
            >
              {isGeneratingIdentity ? 'Generating Identity...' : 'Generate Voting Identity'}
            </button>
          ) : !hasJoinedGroup ? (
            // Step 2: Join group
            <button
              onClick={handleJoinGroup}
              disabled={isJoiningGroup}
              className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 rounded-lg transition-colors"
            >
              {isJoiningGroup ? 'Joining Group...' : 'Join Voting Group'}
            </button>
          ) : selectedOption !== null ? (
            // Step 3: Cast vote
            <button
              onClick={handleVote}
              disabled={isVoting}
              className="w-full py-2 px-4 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 rounded-lg transition-colors"
            >
              {isVoting ? 'Casting Vote...' : 'Cast Anonymous Vote'}
            </button>
          ) : (
            <p className="text-gray-400 text-sm text-center">
              Select an option to vote
            </p>
          )}
        </div>
      )}

      {/* Success message */}
      {success && (
        <div className="mt-4 p-3 bg-green-900/50 border border-green-700 rounded-lg text-center">
          <p className="text-green-400">Vote cast anonymously!</p>
          <p className="text-xs text-gray-400 mt-1">
            Your vote is recorded. No one can see how you voted.
          </p>
        </div>
      )}

      {/* Already voted indicator */}
      {poll.hasVoted && !success && (
        <div className="mt-4 p-3 bg-blue-900/50 border border-blue-700 rounded-lg text-center">
          <p className="text-blue-400">You have voted</p>
        </div>
      )}
    </div>
  )
}
