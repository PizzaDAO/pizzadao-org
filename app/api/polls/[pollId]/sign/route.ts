import { NextResponse } from 'next/server'

// The legacy poll signer is retired: it signed with the shared RSA_PRIVATE_KEY_PEM, which must never be able to
// mint ballots. Proposals use a per-proposal key (app/lib/proposals/keys.ts). The rest of the old poll code goes in
// a later cleanup.
export async function POST() {
  return NextResponse.json({ error: 'This endpoint has been retired' }, { status: 410, headers: { 'Cache-Control': 'private, no-store' } })
}
