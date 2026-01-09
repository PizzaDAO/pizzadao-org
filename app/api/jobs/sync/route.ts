import { NextRequest, NextResponse } from 'next/server'
import { syncJobsFromSheet, fullRefreshJobs } from '@/app/lib/jobs'

const JOB_SYNC_SECRET = process.env.JOB_SYNC_SECRET

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    // Verify authorization if secret is configured
    if (JOB_SYNC_SECRET) {
      const authHeader = request.headers.get('authorization')
      const token = authHeader?.replace('Bearer ', '')

      if (token !== JOB_SYNC_SECRET) {
        console.warn('Unauthorized job sync attempt')
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }

    // Check for refresh flag
    const body = await request.json().catch(() => ({}))
    const fullRefresh = body.refresh === true

    console.log(`Job sync triggered via webhook (refresh: ${fullRefresh})`)

    const result = fullRefresh
      ? await fullRefreshJobs()
      : await syncJobsFromSheet()

    return NextResponse.json({
      success: true,
      message: 'Jobs synced successfully',
      ...result
    })
  } catch (error) {
    console.error('Error in job sync webhook:', error)
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
      sheetId: process.env.JOBS_SHEET_ID,
      message: 'Job sync endpoint ready. POST to trigger sync.'
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
