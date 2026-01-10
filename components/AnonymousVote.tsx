'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  importPublicKey,
  prepareMessage,
  blind,
  finalize,
  toBase64,
  fromBase64,
} from '@/utils/blindRsa.client'

type PollOption = { id: string; label: string }
type PollResult = { optionId: string; tally: number }

type PollData = {
  id: string
  question: string
  options: PollOption[]
  status: 'DRAFT' | 'OPEN' | 'CLOSED'
  requiredRoleId: string
  results?: PollResult[]
}

type UserStatus = {
  isEligible: boolean
  hasClaimedToken: boolean
}

export default function AnonymousVote({ pollId }: { pollId: string }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [poll, setPoll] = useState<PollData | null>(null)
  const [userStatus, setUserStatus] = useState<UserStatus | null>(null)
  const [selectedOption, setSelectedOption] = useState<string | null>(null)
  const [hasVoted, setHasVoted] = useState(false)
  const [claimingToken, setClaimingToken] = useState(false)

  // Fetch poll status
  useEffect(() => {
    async function fetchStatus() {
      try {
        const res = await fetch(`/api/polls/${pollId}/status`)
        if (res.status === 401) {
          // Not logged in - redirect to login
          window.location.href = '/api/discord/login'
          return
        }
        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to load poll')
        }
        const data = await res.json()
        setPoll(data.poll)
        setUserStatus(data.user)
      } catch (e: any) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    }
    fetchStatus()
  }, [pollId])

  // Combined: Claim token and submit vote in one step
  const voteAnonymously = useCallback(async (optionId: string) => {
    if (!poll || !userStatus?.isEligible) return
    setClaimingToken(true)
    setError(null)

    try {
      // Get public key from environment (exposed via API)
      const pubKeyRes = await fetch('/api/voting-pubkey')
      if (!pubKeyRes.ok) throw new Error('Failed to get public key')
      const { publicKey: publicKeyPem } = await pubKeyRes.json()

      // Import public key
      const publicKey = await importPublicKey(publicKeyPem)

      // Generate unique token message
      const nonce = crypto.randomUUID()
      const tokenMessage = `poll-${pollId}-${nonce}`

      // Prepare and blind the message
      const preparedMsg = await prepareMessage(tokenMessage)
      const { blindedMessage, blindInverse } = await blind(publicKey, preparedMsg)

      // Send blinded message to server for signing
      const signRes = await fetch(`/api/polls/${pollId}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blindedMessage: toBase64(blindedMessage),
        }),
      })

      if (!signRes.ok) {
        const data = await signRes.json()
        throw new Error(data.error || 'Failed to get signature')
      }

      const { blindSignature } = await signRes.json()

      // Unblind the signature
      const blindSigBytes = fromBase64(blindSignature)
      const finalSignature = await finalize(publicKey, preparedMsg, blindSigBytes, blindInverse)

      // Now immediately submit the vote
      // Include preparedMsg for verification (contains PSS salt, needed for verify)
      const voteRes = await fetch('/api/vote/anonymous', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: tokenMessage,
          preparedMessage: toBase64(preparedMsg),
          signature: toBase64(finalSignature),
          pollId,
          optionId,
        }),
      })

      if (!voteRes.ok) {
        const data = await voteRes.json()
        if (data.error === 'You have already voted') {
          setHasVoted(true)
          return
        }
        throw new Error(data.error || 'Failed to submit vote')
      }

      setHasVoted(true)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setClaimingToken(false)
    }
  }, [poll, pollId, userStatus?.isEligible])

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-gray-600">Loading poll...</p>
      </div>
    )
  }

  if (error && !poll) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <p className="text-red-600">{error}</p>
      </div>
    )
  }

  if (!poll) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <p className="text-gray-600">Poll not found</p>
      </div>
    )
  }

  // Poll is in draft
  if (poll.status === 'DRAFT') {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-2">{poll.question}</h2>
        <p className="text-gray-500">This poll is not yet open for voting.</p>
      </div>
    )
  }

  // Poll is closed - show results
  if (poll.status === 'CLOSED') {
    const totalVotes = poll.results?.reduce((sum, r) => sum + r.tally, 0) || 0
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">{poll.question}</h2>
        <p className="text-sm text-gray-500 mb-4">This poll has ended. Total votes: {totalVotes}</p>
        <div className="space-y-3">
          {poll.options.map(opt => {
            const votes = poll.results?.find(r => r.optionId === opt.id)?.tally || 0
            const percentage = totalVotes > 0 ? (votes / totalVotes) * 100 : 0
            return (
              <div key={opt.id}>
                <div className="flex justify-between text-sm mb-1">
                  <span>{opt.label}</span>
                  <span className="text-gray-500">{votes} votes ({percentage.toFixed(1)}%)</span>
                </div>
                <div className="h-2 bg-gray-200 rounded">
                  <div
                    className="h-2 bg-blue-600 rounded"
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // Poll is open - voting UI
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-xl font-semibold mb-4">{poll.question}</h2>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded p-3 mb-4">
          <p className="text-red-600 text-sm">{error}</p>
        </div>
      )}

      {/* User has already voted */}
      {hasVoted && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <p className="text-green-700 font-medium">Your vote has been recorded.</p>
          <p className="text-green-600 text-sm mt-1">
            Your identity is protected by blind signature cryptography. No one can see how you voted.
          </p>
        </div>
      )}

      {/* User is not eligible */}
      {!hasVoted && userStatus && !userStatus.isEligible && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <p className="text-yellow-700">You are not eligible to vote in this poll.</p>
          <p className="text-yellow-600 text-sm mt-1">
            This poll requires a specific Discord role that you don&apos;t have.
          </p>
        </div>
      )}

      {/* User is eligible - single step voting */}
      {!hasVoted && userStatus?.isEligible && (
        <div>
          <div className="space-y-2 mb-6">
            {poll.options.map(opt => (
              <label
                key={opt.id}
                className="flex items-center p-3 border rounded cursor-pointer hover:bg-gray-50"
              >
                <input
                  type="radio"
                  name="vote"
                  value={opt.id}
                  checked={selectedOption === opt.id}
                  onChange={() => setSelectedOption(opt.id)}
                  className="mr-3"
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>

          <button
            onClick={() => selectedOption && voteAnonymously(selectedOption)}
            disabled={!selectedOption || claimingToken}
            className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {claimingToken ? 'Submitting vote...' : 'Vote'}
          </button>

          <p className="text-xs text-gray-500 mt-3 text-center">
            Your identity is protected by blind signature cryptography
          </p>
        </div>
      )}
    </div>
  )
}
