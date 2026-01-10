'use client'

import { useState, useCallback, useEffect } from 'react'
import { usePrivy, useWallets } from '@privy-io/react-auth'
import { Identity, Group } from '@semaphore-protocol/core'
import {
  generateIdentityFromWallet,
  storeIdentityCommitment,
  getStoredCommitment,
  clearStoredCommitment,
} from '@/lib/semaphore/identity'
import {
  generateVoteProof,
  verifyVoteProof,
  getNullifierHash,
} from '@/lib/semaphore/voting'

interface UseSemaphoreReturn {
  // Identity state
  identity: Identity | null
  commitment: bigint | null
  isGeneratingIdentity: boolean
  identityError: string | null

  // Actions
  generateIdentity: () => Promise<void>
  clearIdentity: () => void

  // Voting
  vote: (group: Group, pollId: string, optionIndex: number) => Promise<{
    proof: Awaited<ReturnType<typeof generateVoteProof>>
    nullifierHash: string
  }>
  isVoting: boolean
  voteError: string | null
}

export function useSemaphore(): UseSemaphoreReturn {
  const { authenticated } = usePrivy()
  const { wallets } = useWallets()

  const [identity, setIdentity] = useState<Identity | null>(null)
  const [commitment, setCommitment] = useState<bigint | null>(null)
  const [isGeneratingIdentity, setIsGeneratingIdentity] = useState(false)
  const [identityError, setIdentityError] = useState<string | null>(null)
  const [isVoting, setIsVoting] = useState(false)
  const [voteError, setVoteError] = useState<string | null>(null)

  // Check for stored commitment on mount
  useEffect(() => {
    const stored = getStoredCommitment()
    if (stored) {
      setCommitment(stored)
    }
  }, [])

  // Generate Semaphore identity from wallet signature
  const generateIdentity = useCallback(async () => {
    if (!authenticated || !wallets.length) {
      setIdentityError('Please connect your wallet first')
      return
    }

    const embeddedWallet = wallets.find(w => w.walletClientType === 'privy')
    if (!embeddedWallet) {
      setIdentityError('No embedded wallet found')
      return
    }

    setIsGeneratingIdentity(true)
    setIdentityError(null)

    try {
      // Get the wallet provider to sign messages
      const provider = await embeddedWallet.getEthereumProvider()

      const signMessage = async (message: string): Promise<string> => {
        const signature = await provider.request({
          method: 'personal_sign',
          params: [message, embeddedWallet.address],
        })
        return signature as string
      }

      const newIdentity = await generateIdentityFromWallet(signMessage)
      const newCommitment = newIdentity.commitment

      setIdentity(newIdentity)
      setCommitment(newCommitment)
      storeIdentityCommitment(newCommitment)

    } catch (error) {
      console.error('Failed to generate identity:', error)
      setIdentityError(error instanceof Error ? error.message : 'Failed to generate identity')
    } finally {
      setIsGeneratingIdentity(false)
    }
  }, [authenticated, wallets])

  // Clear identity
  const clearIdentity = useCallback(() => {
    setIdentity(null)
    setCommitment(null)
    clearStoredCommitment()
  }, [])

  // Generate vote proof
  const vote = useCallback(async (
    group: Group,
    pollId: string,
    optionIndex: number
  ) => {
    if (!identity) {
      throw new Error('Please generate your identity first')
    }

    setIsVoting(true)
    setVoteError(null)

    try {
      const proof = await generateVoteProof(identity, group, pollId, optionIndex)

      // Verify the proof locally before submitting
      const isValid = await verifyVoteProof(proof)
      if (!isValid) {
        throw new Error('Generated proof is invalid')
      }

      const nullifierHash = getNullifierHash(proof)

      return { proof, nullifierHash }

    } catch (error) {
      console.error('Failed to generate vote proof:', error)
      const message = error instanceof Error ? error.message : 'Failed to vote'
      setVoteError(message)
      throw error
    } finally {
      setIsVoting(false)
    }
  }, [identity])

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
  }
}
