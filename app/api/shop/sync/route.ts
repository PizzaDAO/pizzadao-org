// POST /api/shop/sync: Google-Sheet -> shop sync, pushed by an Apps Script.
//
// RETIRED: the shop is now managed in the app at /admin/shop (with an audit
// log). A sheet push would overwrite those edits (prices, stock, availability)
// and deactivate every item missing from the sheet, so this endpoint is a
// no-op unless SHOP_SHEET_SYNC_ENABLED=1. While off, an authorized push gets
// 200 { success: true, skipped: true } (so a stray Apps Script trigger doesn't
// retry or alert) and nothing is written. The secret is still checked first.
// Kept for now so the sync can be turned back on in an emergency; remove it
// (and the Apps Script trigger) once /admin/shop has been the source of truth
// for a while.
import { NextRequest, NextResponse } from 'next/server'
import { checkSecret } from '@/app/lib/auth-guards'
import { shopSheetSyncEnabled, syncShopItemsFromData } from '@/app/lib/shop'

export const runtime = 'nodejs'

const DISABLED_MESSAGE =
  'Shop sheet sync is disabled: the shop is managed at /admin/shop. Set SHOP_SHEET_SYNC_ENABLED=1 to re-enable it.'

export async function POST(request: NextRequest) {
  try {
    // Always require the shared secret. If JOB_SYNC_SECRET is unset the
    // endpoint is disabled (503) rather than open to everyone.
    const authHeader = request.headers.get('authorization')
    const syncSecretHeader = request.headers.get('x-sync-secret')
    const token = syncSecretHeader || authHeader?.replace(/^Bearer\s+/i, '')
    const denied = checkSecret(token, 'JOB_SYNC_SECRET')
    if (denied) return denied

    if (!shopSheetSyncEnabled()) {
      console.warn('[shop-sync] push ignored: SHOP_SHEET_SYNC_ENABLED is not 1 (shop is managed at /admin/shop)')
      return NextResponse.json({ success: true, skipped: true, message: DISABLED_MESSAGE })
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
  const enabled = shopSheetSyncEnabled()
  return NextResponse.json({
    configured: true,
    enabled,
    message: enabled
      ? 'Shop sync endpoint ready. POST with { items: [...] } to trigger sync.'
      : DISABLED_MESSAGE,
  })
}
