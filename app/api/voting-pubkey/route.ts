import { NextResponse } from 'next/server'

// GET /api/voting-pubkey - Get the public key for blind RSA voting
// This is safe to expose - it's the PUBLIC key
export async function GET() {
  const publicKey = process.env.RSA_PUBLIC_KEY_PEM

  if (!publicKey) {
    return NextResponse.json(
      { error: 'Voting system not configured' },
      { status: 500 }
    )
  }

  return NextResponse.json({ publicKey })
}
