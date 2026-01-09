import { NextResponse } from 'next/server'
import { prisma } from '@/app/lib/db'
import { importPublicKey, verify, fromBase64, hashToken } from '@/utils/blindRsa'

// POST /api/vote/anonymous - Submit an anonymous vote
// No authentication required - the valid signature IS the authentication
export async function POST(req: Request) {
  const body = await req.json()
  const { token, signature, pollId, optionId } = body

  // Validate input
  if (!token || typeof token !== 'string') {
    return NextResponse.json({ error: 'Token is required' }, { status: 400 })
  }
  if (!signature || typeof signature !== 'string') {
    return NextResponse.json({ error: 'Signature is required' }, { status: 400 })
  }
  if (!pollId || typeof pollId !== 'string') {
    return NextResponse.json({ error: 'Poll ID is required' }, { status: 400 })
  }
  if (!optionId || typeof optionId !== 'string') {
    return NextResponse.json({ error: 'Option ID is required' }, { status: 400 })
  }

  // Get poll and verify it exists and is open
  const poll = await prisma.poll.findUnique({ where: { id: pollId } })
  if (!poll) {
    return NextResponse.json({ error: 'Poll not found' }, { status: 404 })
  }
  if (poll.status !== 'OPEN') {
    return NextResponse.json({ error: 'Poll is not open for voting' }, { status: 400 })
  }

  // Verify option exists in poll
  const options = poll.options as Array<{ id: string; label: string }>
  if (!options.some(opt => opt.id === optionId)) {
    return NextResponse.json({ error: 'Invalid option' }, { status: 400 })
  }

  // Verify token is for this poll
  if (!token.startsWith(`poll-${pollId}-`)) {
    return NextResponse.json({ error: 'Token is not for this poll' }, { status: 400 })
  }

  // Verify signature
  const publicKeyPem = process.env.RSA_PUBLIC_KEY_PEM
  if (!publicKeyPem) {
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  try {
    const publicKey = await importPublicKey(publicKeyPem)
    const signatureBytes = fromBase64(signature)
    const tokenBytes = new TextEncoder().encode(token)

    const isValid = await verify(publicKey, signatureBytes, tokenBytes)
    if (!isValid) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  } catch (e: any) {
    console.error('Verification error:', e)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  // Check if token has already been used (double-vote prevention)
  const tokenHashValue = await hashToken(token)

  const existingVote = await prisma.consumedToken.findUnique({
    where: { tokenHash: tokenHashValue },
  })

  if (existingVote) {
    return NextResponse.json({ error: 'You have already voted' }, { status: 403 })
  }

  // Record vote and mark token as consumed in a transaction
  await prisma.$transaction([
    // Upsert poll result (increment tally)
    prisma.pollResult.upsert({
      where: {
        pollId_optionId: { pollId, optionId },
      },
      update: {
        tally: { increment: 1 },
      },
      create: {
        pollId,
        optionId,
        tally: 1,
      },
    }),
    // Mark token as consumed
    prisma.consumedToken.create({
      data: {
        tokenHash: tokenHashValue,
        pollId,
      },
    }),
  ])

  return NextResponse.json({ success: true })
}
