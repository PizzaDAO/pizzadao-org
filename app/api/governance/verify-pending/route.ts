import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyProof, type SemaphoreProof } from '@semaphore-protocol/core'

/**
 * POST /api/governance/verify-pending
 *
 * Verify all pending votes. Admin-only endpoint.
 */
export async function POST() {
  const log = (msg: string) => console.log(`[Verify Pending] ${msg}`)

  try {
    // Get all pending votes
    const pendingVotes = await prisma.anonVoteNullifier.findMany({
      where: { status: 'PENDING' },
    })

    log(`Found ${pendingVotes.length} pending votes`)

    const results = {
      verified: 0,
      rejected: 0,
      errors: 0,
    }

    for (const vote of pendingVotes) {
      if (!vote.proofData) {
        log(`Vote ${vote.id.slice(0, 8)} has no proof data, skipping`)
        continue
      }

      try {
        log(`Verifying vote ${vote.id.slice(0, 8)}...`)
        const proof = vote.proofData as unknown as SemaphoreProof
        const startTime = Date.now()
        const isValid = await verifyProof(proof)
        const elapsed = Math.round((Date.now() - startTime) / 1000)
        log(`Vote ${vote.id.slice(0, 8)} verification took ${elapsed}s - valid: ${isValid}`)

        if (isValid) {
          await prisma.$transaction([
            prisma.anonVoteNullifier.update({
              where: { id: vote.id },
              data: { status: 'VERIFIED', verifiedAt: new Date() },
            }),
            prisma.anonPollResult.upsert({
              where: { pollId_optionIndex: { pollId: vote.pollId, optionIndex: vote.optionIndex } },
              create: { pollId: vote.pollId, optionIndex: vote.optionIndex, count: 1 },
              update: { count: { increment: 1 } },
            }),
          ])
          results.verified++
        } else {
          await prisma.anonVoteNullifier.update({
            where: { id: vote.id },
            data: { status: 'REJECTED' },
          })
          results.rejected++
        }
      } catch (error) {
        log(`Error verifying vote ${vote.id.slice(0, 8)}: ${error}`)
        results.errors++
      }
    }

    log(`Done. Verified: ${results.verified}, Rejected: ${results.rejected}, Errors: ${results.errors}`)

    return NextResponse.json({
      success: true,
      total: pendingVotes.length,
      ...results,
    })
  } catch (error) {
    console.error('[Verify Pending] ERROR:', error)
    return NextResponse.json(
      { error: 'Failed to verify pending votes' },
      { status: 500 }
    )
  }
}
