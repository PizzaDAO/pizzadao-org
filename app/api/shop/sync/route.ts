import { NextRequest, NextResponse } from 'next/server'
import { checkSecret } from '@/app/lib/auth-guards'
import { syncShopItemsFromData } from '@/app/lib/shop'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    // Always require the shared secret. If JOB_SYNC_SECRET is unset the
    // endpoint is disabled (503) rather than open to everyone.
    const authHeader = request.headers.get('authorization')
    const syncSecretHeader = request.headers.get('x-sync-secret')
    const token = syncSecretHeader || authHeader?.replace(/^Bearer\s+/i, '')
    const denied = checkSecret(token, 'JOB_SYNC_SECRET')
    if (denied) return denied

    // Parse request body
    const body = await request.json().catch(() => ({}))

    // Check if items data was sent directly (from Google Apps Script)
    if (body.items && Array.isArray(body.items)) {
      const result = await syncShopItemsFromData(body.items)
      return NextResponse.json({
        success: true,
        message: 'Shop items synced successfully',
        ...result
      })
    }

    return NextResponse.json({
      error: 'No items data provided. Send { items: [...] } in request body.'
    }, { status: 400 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// GET for status check
export async function GET() {
  return NextResponse.json({
    configured: true,
    message: 'Shop sync endpoint ready. POST with { items: [...] } to trigger sync.'
  })
}
