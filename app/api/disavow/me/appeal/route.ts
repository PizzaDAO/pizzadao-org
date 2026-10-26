import { disavowEnabled } from '@/app/lib/disavow/constants'
import { disavowNotFound, findSubjectDisavowal } from '@/app/lib/disavow/access'
import { getSession } from '@/app/lib/session'
import { out, safe } from '@/app/lib/disavow/http'
import { openRemoveRound } from '@/app/lib/disavow/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST /api/disavow/me/appeal — the listed member asks for a DPR removal vote (once per 90 days). */
export const POST = safe('me-appeal', async () => {
  if (!disavowEnabled()) return disavowNotFound()
  const session = await getSession().catch(() => null)
  if (!session?.discordId) return disavowNotFound()
  const mine = await findSubjectDisavowal(session.discordId)
  if (!mine) return disavowNotFound()
  const r = await openRemoveRound(mine.id, session.discordId, { appeal: true })
  if (r === 'ok') return out({ ok: true }, 201)
  if (r === 'too_soon') return out({ error: 'You can appeal once every 90 days', code: 'TOO_SOON' }, 429)
  if (r === 'already_open') return out({ error: 'A vote is already open' }, 409)
  return out({ error: 'Cannot appeal now' }, 409)
})
