import { NextRequest, NextResponse } from 'next/server'
import { syncShopItemsFromData } from '@/app/lib/shop'

const SHOP_SYNC_SECRET = process.env.JOB_SYNC_SECRET // Reuse same secret

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    // Verify authorization if secret is configured
    if (SHOP_SYNC_SECRET) {
      const authHeader = request.headers.get('authorization')
      const syncSecretHeader = request.headers.get('x-sync-secret')
      const token = syncSecretHeader || authHeader?.replace('Bearer ', '')

      if (token !== SHOP_SYNC_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }

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
