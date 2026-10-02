import { NextRequest, NextResponse } from 'next/server'
import { checkSecret } from '@/app/lib/auth-guards'
import { syncJobsFromSheet, fullRefreshJobs, syncJobsFromData } from '@/app/lib/jobs'

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

    // Check if jobs data was sent directly (from Google Apps Script)
    if (body.jobs && Array.isArray(body.jobs)) {
      const result = await syncJobsFromData(body.jobs)
      return NextResponse.json({
        success: true,
        message: 'Jobs synced successfully',
        ...result
      })
    }

    // Otherwise, fetch from Google Sheets
    const fullRefresh = body.refresh === true

    const result = fullRefresh
      ? await fullRefreshJobs()
      : await syncJobsFromSheet()

    return NextResponse.json({
      success: true,
      message: 'Jobs synced successfully',
      ...result
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// Also allow GET for easy testing
export async function GET() {
  try {
    if (!process.env.JOBS_SHEET_ID) {
      return NextResponse.json({
        configured: false,
        message: 'JOBS_SHEET_ID not configured'
      })
    }

    return NextResponse.json({
      configured: true,
      message: 'Job sync endpoint ready. POST to trigger sync.'
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
