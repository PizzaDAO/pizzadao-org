import { NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { getNotifications, getUnreadCount } from '@/app/lib/notifications'
import { internalError } from '@/app/lib/errors/error-response'

export const runtime = 'nodejs'

/**
 * GET /api/notifications
 * Returns user's recent notifications and unread count
 */
export async function GET() {
  try {
    const session = await getSession()

    if (!session?.discordId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const [notifications, unreadCount] = await Promise.all([
      getNotifications(session.discordId),
      getUnreadCount(session.discordId)
    ])

    return NextResponse.json({
      notifications,
      unreadCount
    })
  } catch (error) {
    console.error('Failed to fetch notifications:', error)
    return internalError(error, 'notifications')
  }
}
