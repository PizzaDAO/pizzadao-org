'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { Identity, Group, generateProof, type SemaphoreProof } from '@semaphore-protocol/core'
import { usePrivy, useWallets } from '@privy-io/react-auth'

const IDENTITY_STORAGE_KEY = 'semaphore_identity_secret'

interface UseSemaphoreReturn {
  identity: Identity | null
  commitment: string | null
  isGeneratingIdentity: boolean
  identityError: string | null
  generateIdentity: () => Promise<void>
  clearIdentity: () => void
  vote: (group: Group, pollId: string, optionIndex: number) => Promise<{
    proof: SemaphoreProof
    nullifier: string
  }>
  isVoting: boolean
  voteError: string | null
  hasStoredIdentity: boolean
  isReady: boolean
  isWaitingForWallet: boolean
}

export function useSemaphore(discordId?: string): UseSemaphoreReturn {
  const { ready, authenticated, signMessage } = usePrivy()
  const { wallets, ready: walletsReady } = useWallets()
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [commitment, setCommitment] = useState<string | null>(null)
  const [isGeneratingIdentity, setIsGeneratingIdentity] = useState(false)
  const [identityError, setIdentityError] = useState<string | null>(null)
  const [isVoting, setIsVoting] = useState(false)
  const [voteError, setVoteError] = useState<string | null>(null)
  const [hasStoredIdentity, setHasStoredIdentity] = useState(false)
  const autoGenerateAttempted = useRef(false)

  // Check if user has an embedded wallet ready
  const hasWallet = walletsReady && wallets.length > 0

  // Load identity from storage on mount, or check DB if not in localStorage
  useEffect(() => {
    async function loadIdentity() {
      // First check localStorage
      const stored = localStorage.getItem(IDENTITY_STORAGE_KEY)
      if (stored) {
        try {
          const id = new Identity(stored)
          const localCommitment = id.commitment.toString()

          // Verify localStorage commitment matches DB commitment
          if (discordId) {
            const res = await fetch(`/api/governance/identity?discordId=${discordId}`)
            const data = await res.json()
            if (data.hasIdentity && data.commitment && data.commitment !== localCommitment) {
              // Mismatch! Clear localStorage and force regeneration
              console.log('[useSemaphore] Commitment mismatch - clearing localStorage')
              localStorage.removeItem(IDENTITY_STORAGE_KEY)
              setHasStoredIdentity(false)
              return
            }
          }

          setIdentity(id)
          setCommitment(localCommitment)
          setHasStoredIdentity(true)
          return
        } catch {
          localStorage.removeItem(IDENTITY_STORAGE_KEY)
        }
      }

      // If not in localStorage but user is authenticated, check DB
      if (discordId) {
        try {
          const res = await fetch(`/api/governance/identity?discordId=${discordId}`)
          const data = await res.json()
          if (data.hasIdentity && data.commitment) {
            // User has identity in DB but not locally - they'll need to sign again
            setHasStoredIdentity(false)
          }
        } catch {
          // Ignore errors
        }
      }
    }

    loadIdentity()
  }, [discordId])

  // Auto-generate identity when user is authenticated with Privy and has discordId
  // Don't wait for wallet array - Privy handles embedded wallet creation internally
  useEffect(() => {
    const shouldAutoGenerate = ready && authenticated && discordId && !hasStoredIdentity && !isGeneratingIdentity && !autoGenerateAttempted.current

    if (shouldAutoGenerate) {
      // Small delay to let Privy initialize fully
      const timer = setTimeout(() => {
        if (!autoGenerateAttempted.current) {
          autoGenerateAttempted.current = true
          generateIdentityInternal()
        }
      }, 1000)
      return () => clearTimeout(timer)
    }
  }, [ready, authenticated, discordId, hasStoredIdentity, isGeneratingIdentity])

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
      // This message is constant per user, so the signature (and identity) is deterministic
      const message = `PizzaDAO Governance Identity: ${discordId}`

      // Use Privy's signMessage with a timeout
      // Privy will create embedded wallet if needed and handle signing
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

      // Store commitment in database (will return existing if already stored)
      const res = await fetch('/api/governance/identity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commitment: newCommitment, discordId }),
      })

      const responseData = await res.json()

      if (!res.ok) {
        // If identity already exists, that's fine - we just regenerated the same one
        if (responseData.error !== 'Identity already exists') {
          throw new Error(responseData.error || 'Failed to store identity')
        }
      }

      // Store secret locally for proof generation
      localStorage.setItem(IDENTITY_STORAGE_KEY, signatureHex)

      setIdentity(newIdentity)
      setCommitment(newCommitment)
      setHasStoredIdentity(true)

    } catch (error) {
      console.error('[useSemaphore] Identity generation error:', error)
      setIdentityError(error instanceof Error ? error.message : 'Failed to generate identity')
      // Reset so user can retry
      autoGenerateAttempted.current = false
    } finally {
      setIsGeneratingIdentity(false)
    }
  }, [discordId, signMessage, isGeneratingIdentity])

  // Public method to manually trigger identity generation
  const generateIdentity = useCallback(async () => {
    autoGenerateAttempted.current = true
    await generateIdentityInternal()
  }, [generateIdentityInternal])

  // Clear identity
  const clearIdentity = useCallback(() => {
    setIdentity(null)
    setCommitment(null)
    setHasStoredIdentity(false)
    autoGenerateAttempted.current = false
    localStorage.removeItem(IDENTITY_STORAGE_KEY)
  }, [])

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

  // Ready when we have identity or are not going to auto-generate
  const isReady = hasStoredIdentity || (!authenticated && ready) || identityError !== null

  // Waiting for wallet when authenticated but no wallet yet
  const isWaitingForWallet = authenticated && ready && walletsReady && !hasWallet && !identityError

  return {
    identity,
    commitment,
    isGeneratingIdentity,
    identityError,
    generateIdentity,
    clearIdentity,
    vote,
    isVoting,
    voteError,
    hasStoredIdentity,
    isReady,
    isWaitingForWallet,
  }
}
