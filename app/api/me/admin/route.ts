// app/api/me/admin/route.ts
// Lightweight endpoint that returns whether the current session has any admin
// role. Kept separate from /api/me to avoid hitting Discord on every page load.
import { NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { hasAnyRole } from '@/app/lib/discord'
import { ADMIN_ROLE_IDS } from '@/app/ui/constants'

export const runtime = 'nodejs'

export async function GET() {
  const session = await getSession()
  if (!session?.discordId) {
    return NextResponse.json({ isAdmin: false }, { status: 200 })
  }
  let isAdmin = false
  try {
    isAdmin = await hasAnyRole(session.discordId, ADMIN_ROLE_IDS)
  } catch {
    isAdmin = false
  }
  return NextResponse.json(
    { isAdmin },
    { headers: { 'Cache-Control': 'private, max-age=60' } }
  )
}
