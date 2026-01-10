import { NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { hasRole } from '@/app/lib/discord'
import { prisma } from '@/app/lib/db'
import { importPrivateKey, blindSign, fromBase64, toBase64 } from '@/utils/blindRsa'

type Params = { params: Promise<{ pollId: string }> }

// POST /api/polls/[pollId]/sign - Get a blind signature for voting
// Client sends: { blindedMessage: base64 }
// Server returns: { blindSignature: base64 }
export async function POST(req: Request, { params }: Params) {
  const { pollId } = await params
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get poll
  const poll = await prisma.poll.findUnique({ where: { id: pollId } })
  if (!poll) {
    return NextResponse.json({ error: 'Poll not found' }, { status: 404 })
  }

  if (poll.status !== 'OPEN') {
    return NextResponse.json({ error: 'Poll is not open for voting' }, { status: 400 })
  }

  // Check if user has required role
  const hasRequiredRole = await hasRole(session.discordId, poll.requiredRoleId)
  if (!hasRequiredRole) {
    return NextResponse.json({ error: 'You are not eligible for this poll' }, { status: 403 })
  }

  // Check if user already got a signature for this poll
  const existing = await prisma.pendingSignature.findUnique({
    where: {
      userId_pollId: {
        userId: session.discordId,
        pollId: pollId,
      },
    },
  })

  if (existing) {
    return NextResponse.json(
      { error: 'You have already claimed your voting token' },
      { status: 400 }
    )
  }

  // Get the blinded message from client
  const body = await req.json()
  const { blindedMessage } = body

  if (!blindedMessage || typeof blindedMessage !== 'string') {
    return NextResponse.json({ error: 'blindedMessage is required' }, { status: 400 })
  }

  // Sign the blinded message
  const privateKeyPem = process.env.RSA_PRIVATE_KEY_PEM
  if (!privateKeyPem) {
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  try {
    const privateKey = await importPrivateKey(privateKeyPem)
    const blindedBytes = fromBase64(blindedMessage)
    console.log('[sign] Blinded message length:', blindedBytes.length)

    const blindSig = await blindSign(privateKey, blindedBytes)
    console.log('[sign] Blind signature length:', blindSig.length)

    // Ensure user exists in our database
    await prisma.user.upsert({
      where: { id: session.discordId },
      update: { roles: [] }, // We'll update roles separately if needed
      create: { id: session.discordId, roles: [] },
    })

    // Record that this user got a signature (prevents double-claiming)
    // Note: We store a placeholder, not the actual signature (for anonymity)
    await prisma.pendingSignature.create({
      data: {
        userId: session.discordId,
        pollId: pollId,
        blindedSig: 'claimed', // Placeholder - we don't store the actual signature
      },
    })

    return NextResponse.json({
      blindSignature: toBase64(blindSig),
    })
  } catch (e: unknown) {
    console.error('Signing error:', e)
    return NextResponse.json(
      { error: 'Failed to sign token' },
      { status: 500 }
    )
  }
}
