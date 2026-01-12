import { NextResponse } from 'next/server'
import { prisma } from '@/app/lib/db'
import { PrivyClient } from '@privy-io/node'
import { Identity } from '@semaphore-protocol/core'

// Shared secret for internal API calls (from onboarding app)
const INTERNAL_API_SECRET = process.env.GOOGLE_SHEETS_SHARED_SECRET

/**
 * POST /api/governance/create-identity
 *
 * Creates a Semaphore identity for a single Discord user.
 * Called automatically when a new user creates a profile with Discord.
 *
 * Request body:
 * - discordId: string (required) - The user's Discord ID
 * - secret: string (required) - Internal API secret for authentication
 *
 * Response:
 * - success: boolean
 * - commitment?: string (if success)
 * - error?: string (if failure)
 * - alreadyExists?: boolean (if identity already exists)
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { discordId, secret } = body

    // Validate request
    if (!discordId) {
      return NextResponse.json({ error: 'discordId is required' }, { status: 400 })
    }

    // Authenticate - either internal secret or admin Discord ID
    if (secret !== INTERNAL_API_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Validate Discord ID format
    if (!/^\d{17,19}$/.test(discordId)) {
      return NextResponse.json({ error: 'Invalid Discord ID format' }, { status: 400 })
    }

    // Check if identity already exists
    const existing = await prisma.userIdentity.findUnique({
      where: { discordId }
    })

    if (existing) {
      return NextResponse.json({
        success: true,
        commitment: existing.commitment,
        alreadyExists: true,
      })
    }

    // Check for required environment variables
    if (!process.env.PRIVY_APP_SECRET) {
      return NextResponse.json({
        error: 'PRIVY_APP_SECRET not configured'
      }, { status: 500 })
    }

    const authPrivateKey = process.env.PRIVY_AUTH_PRIVATE_KEY?.replace(/^"|"$/g, '')
    const authPublicKey = process.env.PRIVY_AUTH_PUBLIC_KEY?.replace(/^"|"$/g, '')

    if (!authPrivateKey || !authPublicKey) {
      return NextResponse.json({
        error: 'PRIVY_AUTH keys not configured'
      }, { status: 500 })
    }

    // Initialize Privy client
    const privy = new PrivyClient({
      appId: process.env.PRIVY_APP_ID!,
      appSecret: process.env.PRIVY_APP_SECRET!,
    })

    // Create a server-owned wallet for this Discord user
    let wallet
    try {
      wallet = await privy.wallets().create({
        chain_type: 'ethereum',
        owner: { public_key: authPublicKey },
      })
      console.log(`[create-identity] Created wallet for ${discordId}: ${wallet.id}`)
    } catch (walletErr: any) {
      console.error(`[create-identity] Failed to create wallet for ${discordId}:`, walletErr)
      return NextResponse.json({
        error: 'Failed to create wallet'
      }, { status: 500 })
    }

    // Sign the identity message
    const message = `PizzaDAO Governance Identity: ${discordId}`

    let signature: string
    try {
      const signResult = await privy.wallets().ethereum().signMessage(wallet.id, {
        message,
        authorization_context: {
          authorization_private_keys: [authPrivateKey],
        },
      })
      signature = signResult.signature
      console.log(`[create-identity] Signed message for ${discordId}`)
    } catch (signErr: any) {
      console.error(`[create-identity] Failed to sign for ${discordId}:`, signErr)
      return NextResponse.json({
        error: 'Failed to sign identity message'
      }, { status: 500 })
    }

    // Generate Semaphore identity from signature
    const identity = new Identity(signature)
    const commitment = identity.commitment.toString()

    // Store in database
    await prisma.userIdentity.create({
      data: {
        discordId,
        commitment,
      }
    })

    console.log(`[create-identity] Created identity for ${discordId}: ${commitment.slice(0, 20)}...`)

    return NextResponse.json({
      success: true,
      commitment,
    })

  } catch (err) {
    console.error('[create-identity] Error:', err)
    return NextResponse.json({
      error: err instanceof Error ? err.message : 'Failed to create identity'
    }, { status: 500 })
  }
}
