import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyProof, type SemaphoreProof } from '@semaphore-protocol/core'

/**
 * POST /api/governance/vote
 *
 * Cast an anonymous vote with a Semaphore proof.
 * Verifies the ZK proof cryptographically (~10ms) before counting.
 */
export async function POST(req: NextRequest) {
  const log = (msg: string) => console.log(`[Vote API] ${msg}`)

  try {
    const body = await req.json()
    const { pollId, proof } = body as { pollId: string; proof: SemaphoreProof }

    if (!pollId || !proof) {
      return NextResponse.json(
        { error: 'Missing required fields: pollId, proof' },
        { status: 400 }
      )
    }

    // Get the poll
    const poll = await prisma.anonPoll.findUnique({
      where: { id: pollId },
      include: { group: true },
    })

    if (!poll) {
      return NextResponse.json(
        { error: 'Poll not found' },
        { status: 404 }
      )
    }

    if (poll.status !== 'OPEN') {
      return NextResponse.json(
        { error: 'Poll is not open for voting' },
        { status: 400 }
      )
    }

    // Quick validation (without full proof verification)
    // Check merkle root matches
    if (proof.merkleTreeRoot.toString() !== poll.group.merkleRoot) {
      log('Merkle root mismatch')
      return NextResponse.json(
        { error: 'Proof uses incorrect group - you may not be in this voting group' },
        { status: 400 }
      )
    }

    // Get the nullifier and voted option
    const nullifier = proof.nullifier.toString()
    const optionIndex = Number(proof.message)

    // Validate option index
    const options = poll.options as string[]
    if (optionIndex < 0 || optionIndex >= options.length) {
      return NextResponse.json(
        { error: 'Invalid option index' },
        { status: 400 }
      )
    }

    // Check if nullifier has been used (double vote prevention)
    const existingVote = await prisma.anonVoteNullifier.findUnique({
      where: {
        pollId_nullifier: { pollId, nullifier },
      },
    })

    if (existingVote) {
      // Return the existing vote status
      return NextResponse.json(
        {
          error: 'You have already voted on this poll',
          status: existingVote.status,
        },
        { status: 400 }
      )
    }

    // Verify the ZK proof cryptographically
    log(`Verifying proof for poll ${pollId.slice(0, 8)}...`)
    const verifyStart = Date.now()

    let isValid: boolean
    try {
      isValid = await verifyProof(proof)
    } catch (verifyError) {
      log(`Proof verification error: ${verifyError}`)
      return NextResponse.json(
        { error: 'Failed to verify proof' },
        { status: 500 }
      )
    }

    const verifyTime = Date.now() - verifyStart
    log(`Proof verification took ${verifyTime}ms - valid: ${isValid}`)

    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid proof - verification failed' },
        { status: 400 }
      )
    }

    // Save verified vote and increment count in a single transaction
    log(`Saving and counting vote...`)

    const [vote] = await prisma.$transaction([
      prisma.anonVoteNullifier.create({
        data: {
          pollId,
          nullifier,
          optionIndex,
          status: 'VERIFIED',
          verifiedAt: new Date(),
          proofData: proof as object,
        },
      }),
      prisma.anonPollResult.upsert({
        where: { pollId_optionIndex: { pollId, optionIndex } },
        create: { pollId, optionIndex, count: 1 },
        update: { count: { increment: 1 } },
      }),
    ])

    log(`Vote ${vote.id.slice(0, 8)} VERIFIED and counted!`)

    return NextResponse.json({
      success: true,
      message: 'Vote verified and counted!',
      voteId: vote.id,
      status: 'VERIFIED',
    })

  } catch (error) {
    console.error('[Vote API] ERROR:', error)
    return NextResponse.json(
      { error: 'Failed to submit vote' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/governance/vote?nullifier=xxx&pollId=xxx
 *
 * Check vote status by nullifier
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const nullifier = searchParams.get('nullifier')
  const pollId = searchParams.get('pollId')

  if (!nullifier || !pollId) {
    return NextResponse.json(
      { error: 'Missing nullifier or pollId' },
      { status: 400 }
    )
  }

  const vote = await prisma.anonVoteNullifier.findUnique({
    where: {
      pollId_nullifier: { pollId, nullifier },
    },
    select: {
      status: true,
      optionIndex: true,
      createdAt: true,
      verifiedAt: true,
    },
  })

  if (!vote) {
    return NextResponse.json({ voted: false })
  }

  return NextResponse.json({
    voted: true,
    status: vote.status,
    optionIndex: vote.optionIndex,
    createdAt: vote.createdAt,
    verifiedAt: vote.verifiedAt,
  })
}
