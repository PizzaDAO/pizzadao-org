'use client'

import { useState, useEffect, useCallback } from 'react'
import { Group } from '@semaphore-protocol/core'
import { usePrivy } from '@privy-io/react-auth'
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
}

interface PollCardProps {
  poll: Poll
  onVoted?: () => void
}

type VoteStatus = 'none' | 'PENDING' | 'VERIFIED' | 'REJECTED'

// Store vote info in localStorage
function getStoredVote(pollId: string): { nullifier: string; status: VoteStatus; optionIndex: number } | null {
  if (typeof window === 'undefined') return null
  const stored = localStorage.getItem(`vote_${pollId}`)
  if (stored) {
    try {
      return JSON.parse(stored)
    } catch {
      return null
    }
  }
  return null
}

function storeVote(pollId: string, nullifier: string, status: VoteStatus, optionIndex: number) {
  if (typeof window === 'undefined') return
  localStorage.setItem(`vote_${pollId}`, JSON.stringify({ nullifier, status, optionIndex }))
}

export function PollCard({ poll, onVoted }: PollCardProps) {
  const { user } = usePrivy()
  const discordAccount = user?.linkedAccounts?.find(a => a.type === 'discord_oauth')
  const discordId = discordAccount?.subject

  const { identity, commitment, vote, isVoting } = useSemaphore(discordId)
  const [selectedOption, setSelectedOption] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isInGroup, setIsInGroup] = useState<boolean | null>(null)
  const [isCheckingGroup, setIsCheckingGroup] = useState(true)
  const [isSyncing, setIsSyncing] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [votePhase, setVotePhase] = useState<'idle' | 'proof' | 'submit'>('idle')

  // Vote status tracking
  const [voteStatus, setVoteStatus] = useState<VoteStatus>('none')
  const [votedOption, setVotedOption] = useState<number | null>(null)
  const [storedNullifier, setStoredNullifier] = useState<string | null>(null)

  const isOpen = poll.status === 'OPEN'
  const isClosed = poll.status === 'CLOSED'
  const hasVoted = voteStatus !== 'none'

  // Load stored vote on mount
  useEffect(() => {
    const stored = getStoredVote(poll.id)
    if (stored) {
      setVoteStatus(stored.status)
      setVotedOption(stored.optionIndex)
      setStoredNullifier(stored.nullifier)
    }
  }, [poll.id])

  // Poll for vote status updates (if pending)
  useEffect(() => {
    if (voteStatus !== 'PENDING' || !storedNullifier) return

    const checkStatus = async () => {
      try {
        const res = await fetch(`/api/governance/vote?pollId=${poll.id}&nullifier=${storedNullifier}`)
        if (res.ok) {
          const data = await res.json()
          if (data.voted && data.status !== 'PENDING') {
            setVoteStatus(data.status)
            storeVote(poll.id, storedNullifier, data.status, votedOption!)
          }
        }
      } catch {
        // Ignore polling errors
      }
    }

    // Check immediately and then every 10 seconds
    checkStatus()
    const interval = setInterval(checkStatus, 10000)
    return () => clearInterval(interval)
  }, [voteStatus, storedNullifier, poll.id, votedOption])

  // Check if user is in the group, and sync if not
  useEffect(() => {
    if (!commitment || !poll.group || !discordId) {
      setIsCheckingGroup(false)
      return
    }

    async function checkAndSyncMembership() {
      try {
        // First check current membership
        const res = await fetch(`/api/governance/groups/${poll.group!.id}`)
        if (!res.ok) throw new Error('Failed to fetch group')
        const groupData = await res.json()
        const isMember = groupData.members.some(
          (m: { commitment: string }) => m.commitment === commitment
        )

        if (isMember) {
          setIsInGroup(true)
          setIsCheckingGroup(false)
          return
        }

        // Not a member yet - try to sync
        setIsSyncing(true)
        setIsCheckingGroup(false)

        const syncRes = await fetch('/api/governance/sync-me', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ discordId }),
        })

        if (syncRes.ok) {
          // Re-check membership after sync
          const res2 = await fetch(`/api/governance/groups/${poll.group!.id}`)
          if (res2.ok) {
            const groupData2 = await res2.json()
            const isMemberNow = groupData2.members.some(
              (m: { commitment: string }) => m.commitment === commitment
            )
            setIsInGroup(isMemberNow)
          } else {
            setIsInGroup(false)
          }
        } else {
          setIsInGroup(false)
        }
      } catch {
        setIsInGroup(false)
      } finally {
        setIsCheckingGroup(false)
        setIsSyncing(false)
      }
    }

    checkAndSyncMembership()
  }, [commitment, poll.group, discordId])

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

  // Cast vote
  const handleVote = useCallback(async () => {
    if (selectedOption === null || !identity || !poll.group) return

    setError(null)
    setVotePhase('proof')
    setIsSubmitting(true)

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
      const { proof, nullifier } = await vote(semaphoreGroup, poll.id, selectedOption)

      // Now submitting to API
      setVotePhase('submit')

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

      const responseData = await voteRes.json()

      if (!voteRes.ok) {
        throw new Error(responseData.error || responseData.message || 'Failed to submit vote')
      }

      // Vote submitted! Use status from server response
      const status = responseData.status as VoteStatus || 'PENDING'
      storeVote(poll.id, nullifier, status, selectedOption)
      setStoredNullifier(nullifier)
      setVoteStatus(status)
      setVotedOption(selectedOption)
      onVoted?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to vote')
    } finally {
      setIsSubmitting(false)
      setVotePhase('idle')
    }
  }, [selectedOption, identity, poll.group, poll.id, vote, onVoted])

  // Calculate result percentages
  const getResultPercentage = (optionIndex: number) => {
    if (!poll.results || !poll.voteCount) return 0
    const result = poll.results.find(r => r.optionIndex === optionIndex)
    return result ? Math.round((result.count / poll.voteCount) * 100) : 0
  }

  // Get total votes from results
  const getTotalVotes = () => {
    if (!poll.results) return 0
    return poll.results.reduce((sum, r) => sum + r.count, 0)
  }

  // Render vote status pill
  const renderVoteStatusPill = () => {
    if (voteStatus === 'PENDING') {
      return (
        <span className="px-2 py-1 text-xs rounded-full bg-yellow-900 text-yellow-400 flex items-center gap-1">
          <span className="animate-pulse">●</span> Vote Pending
        </span>
      )
    }
    if (voteStatus === 'VERIFIED') {
      return (
        <span className="px-2 py-1 text-xs rounded-full bg-green-900 text-green-400">
          ✓ Voted
        </span>
      )
    }
    if (voteStatus === 'REJECTED') {
      return (
        <span className="px-2 py-1 text-xs rounded-full bg-red-900 text-red-400">
          ✗ Vote Failed
        </span>
      )
    }
    return null
  }

  return (
    <div className="p-6 bg-gray-900 rounded-xl border border-gray-800">
      {/* Status badges */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className={`px-2 py-1 text-xs rounded-full ${
            isOpen ? 'bg-green-900 text-green-400' :
            isClosed ? 'bg-gray-700 text-gray-400' :
            'bg-yellow-900 text-yellow-400'
          }`}>
            {poll.status}
          </span>
          {renderVoteStatusPill()}
        </div>
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
            ) : isOpen && !hasVoted ? (
              // Voting buttons for open polls
              <button
                onClick={() => setSelectedOption(index)}
                disabled={!identity || !isInGroup || isVoting || isCheckingGroup || isSubmitting}
                className={`w-full p-3 rounded-lg text-left transition-colors ${
                  selectedOption === index
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 hover:bg-gray-700'
                } ${(!identity || !isInGroup || isCheckingGroup) ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {option}
              </button>
            ) : hasVoted ? (
              // Show which option was voted for
              <div className={`p-3 rounded-lg ${
                votedOption === index
                  ? 'bg-blue-900/50 border border-blue-700'
                  : 'bg-gray-800'
              }`}>
                <div className="flex items-center justify-between">
                  <span>{option}</span>
                  {votedOption === index && (
                    <span className="text-blue-400 text-sm">Your vote</span>
                  )}
                </div>
              </div>
            ) : (
              // Static display
              <div className="p-3 bg-gray-800 rounded-lg">{option}</div>
            )}
          </div>
        ))}
      </div>

      {/* Vote count for closed polls */}
      {isClosed && (
        <p className="text-sm text-gray-400 mt-4">
          Total votes: {getTotalVotes()}
        </p>
      )}

      {/* Voting flow */}
      {isOpen && !hasVoted && (
        <div className="mt-4 space-y-3">
          {error && (
            <p className="text-red-400 text-sm">{error}</p>
          )}

          {isCheckingGroup || isSyncing ? (
            <div className="text-center text-gray-400 text-sm flex items-center justify-center gap-2">
              <span className="animate-spin">⏳</span>
              {isSyncing ? 'Syncing your eligibility...' : 'Checking eligibility...'}
            </div>
          ) : !isInGroup ? (
            <div className="p-3 bg-yellow-900/30 border border-yellow-700 rounded-lg text-center">
              <p className="text-yellow-400 text-sm">
                You&apos;re not in this voting group. You may not have the required Discord role.
              </p>
            </div>
          ) : selectedOption !== null ? (
            <div className="space-y-2">
              <button
                onClick={handleVote}
                disabled={isSubmitting}
                className="w-full py-2 px-4 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 rounded-lg transition-colors"
              >
                {votePhase === 'proof' ? 'Generating ZK proof...' :
                 votePhase === 'submit' ? 'Submitting vote...' :
                 'Cast Anonymous Vote'}
              </button>
              {isSubmitting && (
                <p className="text-xs text-gray-400 text-center">
                  {votePhase === 'proof'
                    ? 'Creating cryptographic proof of your vote...'
                    : 'Submitting your vote...'}
                </p>
              )}
            </div>
          ) : (
            <p className="text-gray-400 text-sm text-center">
              Select an option to vote
            </p>
          )}
        </div>
      )}

      {/* Vote submitted message */}
      {hasVoted && isOpen && (
        <div className={`mt-4 p-3 rounded-lg text-center ${
          voteStatus === 'PENDING'
            ? 'bg-yellow-900/30 border border-yellow-700'
            : voteStatus === 'VERIFIED'
            ? 'bg-green-900/50 border border-green-700'
            : 'bg-red-900/30 border border-red-700'
        }`}>
          {voteStatus === 'PENDING' && (
            <>
              <p className="text-yellow-400">Vote submitted!</p>
              <p className="text-xs text-gray-400 mt-1">
                Your vote is being verified. This happens in the background - you can close this page.
              </p>
            </>
          )}
          {voteStatus === 'VERIFIED' && (
            <>
              <p className="text-green-400">Vote verified and counted!</p>
              <p className="text-xs text-gray-400 mt-1">
                Your anonymous vote has been recorded.
              </p>
            </>
          )}
          {voteStatus === 'REJECTED' && (
            <>
              <p className="text-red-400">Vote verification failed</p>
              <p className="text-xs text-gray-400 mt-1">
                There was an issue with your vote. Please try again.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
