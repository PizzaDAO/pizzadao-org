import { NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { prisma } from '@/app/lib/db'
import { missionReviewScope } from '@/app/lib/mission-review-access'
import { getSetting } from '@/app/lib/settings'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { UnauthorizedError } from '@/app/lib/errors/api-errors'

export const runtime = 'nodejs'

/**
 * GET /api/missions/version[?queue=1]
 *
 * A cheap change marker for live updates: open tabs poll this and refetch the real data only when
 * a marker changes.
 *   - mine:  the viewer's own completions (count + latest change), one indexed aggregate.
 *   - queue: only with ?queue=1 AND only for mission reviewers (checked here, not trusted from the
 *            client): the pending submissions they may review (count + latest change). Everyone
 *            else gets `queue: null`, never any queue data.
 *   - intervalSeconds: the admin setting missions.liveUpdateSeconds (0 = off).
 */
const GET_HANDLER = async (req: Request) => {
  const session = await getSession()
  if (!session?.discordId) throw new UnauthorizedError()
  const discordId = session.discordId
  const wantQueue = new URL(req.url).searchParams.get('queue') === '1'

  const intervalSeconds = await getSetting('missions.liveUpdateSeconds').catch(() => 15)

  const mineP = prisma.missionCompletion.aggregate({
    where: { discordId },
    _count: { _all: true },
    _max: { updatedAt: true },
  })

  let queueP: Promise<string | null> = Promise.resolve(null)
  if (wantQueue) {
    queueP = (async () => {
      const scope = await missionReviewScope(discordId)
      if (!scope) return null
      const levels = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].filter(scope)
      const q = await prisma.missionCompletion.aggregate({
        where: { status: 'PENDING', discordId: { not: discordId }, mission: { level: { in: levels } } },
        _count: { _all: true },
        _max: { updatedAt: true },
      })
      return `${q._count._all}:${q._max.updatedAt?.getTime() ?? 0}`
    })()
  }

  const [mine, queue] = await Promise.all([mineP, queueP])
  return NextResponse.json(
    { mine: `${mine._count._all}:${mine._max.updatedAt?.getTime() ?? 0}`, queue, intervalSeconds },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}

export const GET = withErrorHandling(GET_HANDLER)
