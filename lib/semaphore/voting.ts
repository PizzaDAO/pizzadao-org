import { generateProof, verifyProof, type SemaphoreProof } from '@semaphore-protocol/core'
import { Identity } from '@semaphore-protocol/core'
import { Group } from '@semaphore-protocol/core'

/**
 * Vote data structure
 */
export interface Vote {
  pollId: string
  optionIndex: number
  proof: SemaphoreProof
  nullifierHash: string
}

/**
 * Poll data structure
 */
export interface Poll {
  id: string
  question: string
  options: string[]
  category: string
  groupId: string
  merkleRoot: string
  status: 'draft' | 'open' | 'closed'
  createdAt: Date
  closesAt: Date
}

/**
 * Generate an anonymous vote proof.
 *
 * @param identity - The voter's Semaphore identity
 * @param group - The voting group
 * @param pollId - The poll identifier (used as external nullifier)
 * @param optionIndex - The option being voted for (used as signal)
 */
export async function generateVoteProof(
  identity: Identity,
  group: Group,
  pollId: string,
  optionIndex: number
): Promise<SemaphoreProof> {
  // The signal is the vote choice
  const signal = optionIndex

  // The external nullifier is the poll ID - ensures one vote per poll
  const externalNullifier = pollId

  const proof = await generateProof(identity, group, signal, externalNullifier)

  return proof
}

/**
 * Verify a vote proof.
 *
 * @param proof - The Semaphore proof
 * @returns Whether the proof is valid
 */
export async function verifyVoteProof(proof: SemaphoreProof): Promise<boolean> {
  return await verifyProof(proof)
}

/**
 * Extract the nullifier hash from a proof.
 * This is used to prevent double voting.
 */
export function getNullifierHash(proof: SemaphoreProof): string {
  return proof.nullifier.toString()
}

/**
 * Extract the voted option from a proof.
 */
export function getVotedOption(proof: SemaphoreProof): number {
  return Number(proof.message)
}

/**
 * Check if a nullifier has been used (vote already cast).
 * This should check against a database of used nullifiers.
 */
export async function isNullifierUsed(
  pollId: string,
  nullifierHash: string
): Promise<boolean> {
  // This will be implemented with database lookup
  // For now, return false
  return false
}

/**
 * Record a vote's nullifier to prevent double voting.
 */
export async function recordNullifier(
  pollId: string,
  nullifierHash: string
): Promise<void> {
  // This will be implemented with database insert
  // For now, just log
  console.log(`Recording nullifier for poll ${pollId}: ${nullifierHash}`)
}
