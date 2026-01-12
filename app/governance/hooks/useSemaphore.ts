'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { Identity, Group, generateProof, type SemaphoreProof } from '@semaphore-protocol/core'
import { usePrivy, useWallets } from '@privy-io/react-auth'

interface UseSemaphoreReturn {
  identity: Identity | null
  commitment: string | null
  isGeneratingIdentity: boolean
  identityError: string | null
  generateIdentity: () => Promise<void>
  vote: (group: Group, pollId: string, optionIndex: number) => Promise<{
    proof: SemaphoreProof
    nullifier: string
  }>
  isVoting: boolean
  voteError: string | null
  hasIdentity: boolean
  isReady: boolean
}

/**
 * Hook for managing Semaphore identity using Privy wallet signatures.
 *
 * The identity is derived deterministically from the wallet signature,
 * so the same wallet + discordId always produces the same identity.
 * No localStorage needed - identity is regenerated each session.
 */
export function useSemaphore(discordId?: string): UseSemaphoreReturn {
  const { ready, authenticated, signMessage } = usePrivy()
  const { wallets, ready: walletsReady } = useWallets()
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [commitment, setCommitment] = useState<string | null>(null)
  const [isGeneratingIdentity, setIsGeneratingIdentity] = useState(false)
  const [identityError, setIdentityError] = useState<string | null>(null)
  const [isVoting, setIsVoting] = useState(false)
  const [voteError, setVoteError] = useState<string | null>(null)
  const [dbCommitment, setDbCommitment] = useState<string | null>(null)
  const autoGenerateAttempted = useRef(false)

  // Check if user has an embedded wallet ready
  const hasWallet = walletsReady && wallets.length > 0

  // Check DB for existing commitment on mount
  useEffect(() => {
    if (!discordId) return

    async function checkDb() {
      try {
        const res = await fetch(`/api/governance/identity?discordId=${discordId}`)
        const data = await res.json()
        if (data.hasIdentity && data.commitment) {
          setDbCommitment(data.commitment)
          console.log('[useSemaphore] Found commitment in DB')
        }
      } catch {
        // Ignore errors
      }
    }

    checkDb()
  }, [discordId])

  // Auto-generate identity when user is authenticated
  useEffect(() => {
    const shouldAutoGenerate = ready && authenticated && discordId && !identity && !isGeneratingIdentity && !autoGenerateAttempted.current

    if (shouldAutoGenerate) {
      // Small delay to let Privy initialize fully
      const timer = setTimeout(() => {
        if (!autoGenerateAttempted.current) {
          autoGenerateAttempted.current = true
          generateIdentityInternal()
        }
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [ready, authenticated, discordId, identity, isGeneratingIdentity])

  // Generate Semaphore identity using Privy wallet signature
  const generateIdentityInternal = useCallback(async () => {
    if (!discordId) {
      setIdentityError('Discord ID required')
      return
    }

    if (isGeneratingIdentity) {
      return
    }

    setIsGeneratingIdentity(true)
    setIdentityError(null)

    try {
      // Sign a deterministic message to generate the identity secret
      // Same wallet + same message = same signature = same identity
      const message = `PizzaDAO Governance Identity: ${discordId}`

      console.log('[useSemaphore] Signing message for identity...')

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error('Signing timed out after 30 seconds. Please refresh and try again.'))
        }, 30000)
      })

      const result = await Promise.race([
        signMessage({ message }),
        timeoutPromise
      ])

      if (!result || !result.signature) {
        throw new Error('Failed to sign message. Please try again.')
      }

      const signatureHex = result.signature

      // Use the signature as the seed for the Semaphore identity
      const newIdentity = new Identity(signatureHex)
      const newCommitment = newIdentity.commitment.toString()

      console.log('[useSemaphore] Identity generated, commitment:', newCommitment.slice(0, 20) + '...')

      // Verify commitment matches DB if we have one
      if (dbCommitment && dbCommitment !== newCommitment) {
        console.error('[useSemaphore] Commitment mismatch! DB:', dbCommitment.slice(0, 20), 'Generated:', newCommitment.slice(0, 20))
        throw new Error('Identity mismatch - your wallet may have changed. Please contact support.')
      }

      // Store commitment in database if not already there
      if (!dbCommitment) {
        console.log('[useSemaphore] Saving commitment to DB...')
        const res = await fetch('/api/governance/identity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ commitment: newCommitment, discordId }),
        })

        if (!res.ok) {
          const data = await res.json()
          if (data.error !== 'Identity already exists') {
            throw new Error(data.error || 'Failed to store identity')
          }
        }
        setDbCommitment(newCommitment)
      }

      setIdentity(newIdentity)
      setCommitment(newCommitment)
      console.log('[useSemaphore] Identity ready!')

    } catch (error) {
      console.error('[useSemaphore] Identity generation error:', error)
      setIdentityError(error instanceof Error ? error.message : 'Failed to generate identity')
      // Reset so user can retry
      autoGenerateAttempted.current = false
    } finally {
      setIsGeneratingIdentity(false)
    }
  }, [discordId, signMessage, isGeneratingIdentity, dbCommitment])

  // Public method to manually trigger identity generation
  const generateIdentity = useCallback(async () => {
    autoGenerateAttempted.current = true
    await generateIdentityInternal()
  }, [generateIdentityInternal])

  // Generate vote proof
  const vote = useCallback(async (
    group: Group,
    pollId: string,
    optionIndex: number
  ) => {
    if (!identity) {
      throw new Error('Please wait for identity to be created')
    }

    setIsVoting(true)
    setVoteError(null)

    try {
      const proof = await generateProof(
        identity,
        group,
        optionIndex,
        pollId
      )

      return {
        proof,
        nullifier: proof.nullifier.toString(),
      }

    } catch (error) {
      console.error('Failed to generate vote proof:', error)
      const message = error instanceof Error ? error.message : 'Failed to vote'
      setVoteError(message)
      throw error
    } finally {
      setIsVoting(false)
    }
  }, [identity])

  // Ready when we have identity or user is not authenticated
  const isReady = !!identity || (!authenticated && ready) || identityError !== null

  return {
    identity,
    commitment,
    isGeneratingIdentity,
    identityError,
    generateIdentity,
    vote,
    isVoting,
    voteError,
    hasIdentity: !!identity,
    isReady,
  }
}
