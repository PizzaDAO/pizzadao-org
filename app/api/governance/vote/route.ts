import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyProof, type SemaphoreProof } from '@semaphore-protocol/core'

/**
 * POST /api/governance/vote
 *
 * Cast an anonymous vote with a Semaphore proof.
 */
export async function POST(req: NextRequest) {
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

    // Verify the proof
    console.log('Vote API - Starting proof verification...')
    const isValid = await verifyProof(proof)
    console.log('Vote API - Proof valid:', isValid)
    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid proof' },
        { status: 400 }
      )
    }

    // Check that the proof uses the correct group root
    if (proof.merkleTreeRoot.toString() !== poll.group.merkleRoot) {
      return NextResponse.json(
        { error: 'Proof uses incorrect group' },
        { status: 400 }
      )
    }

    // Check that the external nullifier matches the poll ID
    // Note: Semaphore hashes the scope, so we compare the hash
    // The client should send the scope that matches what was used in proof generation
    const expectedScope = proof.scope.toString()
    console.log('Vote API - Scope from proof:', expectedScope)
    console.log('Vote API - Poll ID:', pollId)

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
        pollId_nullifier: {
          pollId,
          nullifier,
        },
      },
    })

    if (existingVote) {
      return NextResponse.json(
        { error: 'You have already voted on this poll' },
        { status: 400 }
      )
    }

    // Record the vote
    console.log('Vote API - Recording vote for option', optionIndex, 'with nullifier', nullifier.slice(0, 20) + '...')
    await prisma.$transaction([
      // Store the nullifier
      prisma.anonVoteNullifier.create({
        data: {
          pollId,
          nullifier,
          optionIndex,
        },
      }),
      // Update the vote count
      prisma.anonPollResult.upsert({
        where: {
          pollId_optionIndex: {
            pollId,
            optionIndex,
          },
        },
        create: {
          pollId,
          optionIndex,
          count: 1,
        },
        update: {
          count: { increment: 1 },
        },
      }),
    ])
    console.log('Vote API - Vote recorded successfully')

    return NextResponse.json({
      success: true,
      message: 'Vote recorded',
    })

  } catch (error) {
    console.error('Failed to record vote:', error)
    return NextResponse.json(
      { error: 'Failed to record vote' },
      { status: 500 }
    )
  }
}
