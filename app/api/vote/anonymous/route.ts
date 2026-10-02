import { NextResponse } from 'next/server'
import { enforceRateLimit } from '@/app/lib/rate-limit'
import { prisma } from '@/app/lib/db'
import { importPublicKey, fromBase64, toBase64, hashToken } from '@/utils/blindRsa'
import { validateVoteTokenBinding } from '@/utils/voteToken'

// POST /api/vote/anonymous - Submit an anonymous vote
// No authentication required - the valid signature IS the authentication
export async function POST(req: Request) {
  // Per-IP throttle only; the IP is hashed and never linked to the vote itself.
  const limited = await enforceRateLimit(req, 'vote-anonymous')
  if (limited) return limited

  const body = await req.json()
  const { token, preparedMessage, signature, pollId, optionId } = body

  // Validate input
  if (!token || typeof token !== 'string') {
    return NextResponse.json({ error: 'Token is required' }, { status: 400 })
  }
  if (!preparedMessage || typeof preparedMessage !== 'string') {
    return NextResponse.json({ error: 'Prepared message is required' }, { status: 400 })
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

  // Decode once; used for binding, verification and dedupe
  let signatureBytes: Uint8Array
  let preparedBytes: Uint8Array
  try {
    signatureBytes = fromBase64(signature)
    preparedBytes = fromBase64(preparedMessage)
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  // Verify the token is for this poll AND that the signed prepared message
  // actually encodes this token (32-byte random prefix || UTF-8(token)).
  // Without this, one signature could be replayed with unlimited fresh tokens.
  const bindingError = validateVoteTokenBinding(token, pollId, preparedBytes)
  if (bindingError) {
    return NextResponse.json({ error: bindingError }, { status: 400 })
  }

  // Verify signature
  const publicKeyPem = process.env.RSA_PUBLIC_KEY_PEM
  if (!publicKeyPem) {
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  try {
    const publicKey = await importPublicKey(publicKeyPem)


    // Verify signature against prepared message using Web Crypto directly
    // (SHA-384 = 48 byte salt for RSA-PSS)
    // Create new Uint8Array views to satisfy TypeScript's strict BufferSource type
    const isValid = await crypto.subtle.verify(
      { name: 'RSA-PSS', saltLength: 48 },
      publicKey,
      new Uint8Array(signatureBytes),
      new Uint8Array(preparedBytes)
    )

    if (!isValid) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  } catch (e: unknown) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  // Double-vote prevention: dedupe on the token AND on the signed prepared
  // message and signature, so a signature can never be counted twice.
  const tokenHashValue = await hashToken(token)
  const preparedHashValue = 'prepared:' + (await hashToken(toBase64(preparedBytes)))
  const signatureHashValue = 'sig:' + (await hashToken(toBase64(signatureBytes)))
  const dedupeKeys = [tokenHashValue, preparedHashValue, signatureHashValue]

  const existingVote = await prisma.consumedToken.findFirst({
    where: { tokenHash: { in: dedupeKeys } },
  })

  if (existingVote) {
    return NextResponse.json({ error: 'You have already voted' }, { status: 403 })
  }

  // Record vote and mark token/message/signature consumed in one transaction.
  // The primary-key constraint on tokenHash makes concurrent replays fail here.
  try {
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
      // Mark token, prepared message and signature as consumed
      prisma.consumedToken.createMany({
        data: dedupeKeys.map((tokenHash) => ({ tokenHash, pollId })),
      }),
    ])
  } catch (e: unknown) {
    if ((e as { code?: string })?.code === 'P2002') {
      return NextResponse.json({ error: 'You have already voted' }, { status: 403 })
    }
    throw e
  }

  return NextResponse.json({ success: true })
}
