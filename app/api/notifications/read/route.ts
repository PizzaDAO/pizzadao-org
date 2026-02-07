import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { markAsRead, markAllAsRead } from '@/app/lib/notifications'

export const runtime = 'nodejs'

/**
 * POST /api/notifications/read
 * Mark notification(s) as read
 *
 * Body:
 * - notificationId: string (optional) - mark single notification as read
 * - all: boolean (optional) - mark all notifications as read
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession()

    if (!session?.discordId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const body = await request.json()
    const { notificationId, all } = body

    if (all) {
      const result = await markAllAsRead(session.discordId)
      return NextResponse.json({
        success: true,
        markedCount: result.count
      })
    }

    if (notificationId && typeof notificationId === 'string') {
      const result = await markAsRead(notificationId, session.discordId)
      return NextResponse.json({
        success: true,
        markedCount: result.count
      })
    }

    return NextResponse.json(
      { error: 'Either notificationId or all=true is required' },
      { status: 400 }
    )
  } catch (error) {
    console.error('Failed to mark notifications as read:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
