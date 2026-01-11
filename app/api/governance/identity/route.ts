import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/db'

// GET: Check if user has an identity
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const discordId = searchParams.get('discordId')

    if (!discordId) {
      return NextResponse.json({ hasIdentity: false })
    }

    const identity = await prisma.userIdentity.findUnique({
      where: { discordId },
    })

    return NextResponse.json({
      hasIdentity: !!identity,
      commitment: identity?.commitment,
    })
  } catch (error) {
    console.error('Failed to check identity:', error)
    return NextResponse.json({ error: 'Failed to check identity' }, { status: 500 })
  }
}

// POST: Store user's identity commitment
export async function POST(request: Request) {
  try {
    const { commitment, discordId } = await request.json()

    if (!discordId) {
      return NextResponse.json({ error: 'Discord ID required' }, { status: 400 })
    }

    if (!commitment) {
      return NextResponse.json({ error: 'Commitment required' }, { status: 400 })
    }

    // Check if user already has an identity
    const existing = await prisma.userIdentity.findUnique({
      where: { discordId },
    })

    if (existing) {
      return NextResponse.json({
        success: true,
        commitment: existing.commitment,
        message: 'Identity already exists',
      })
    }

    // Create new identity
    const identity = await prisma.userIdentity.create({
      data: {
        discordId,
        commitment,
      },
    })

    return NextResponse.json({
      success: true,
      commitment: identity.commitment,
    })
  } catch (error) {
    console.error('Failed to store identity:', error)
    return NextResponse.json({ error: 'Failed to store identity' }, { status: 500 })
  }
}
