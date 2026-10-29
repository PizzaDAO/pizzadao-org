import { disavowEnabled } from '@/app/lib/disavow/constants'
import { disavowNotFound, findSubjectDisavowals } from '@/app/lib/disavow/access'
import { getSession } from '@/app/lib/session'
import { out, pickEntry, safe } from '@/app/lib/disavow/http'
import { openRemoveRound } from '@/app/lib/disavow/store'
import { loadDisavowRules } from '@/app/lib/disavow/rules'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST /api/disavow/me/appeal — the listed member asks for a DPR removal vote (once per cooldown, setting disavow.appealCooldownDays). */
export const POST = safe('me-appeal', async (request: Request) => {
  if (!(await disavowEnabled())) return disavowNotFound()
  const session = await getSession().catch(() => null)
  if (!session?.discordId) return disavowNotFound()
  const mine = await findSubjectDisavowals(session.discordId)
  if (mine.length === 0) return disavowNotFound()
  const entry = pickEntry(mine, await request.json().catch(() => null))
  if (!entry) return out({ error: 'Choose which entry' }, 400)
  const r = await openRemoveRound(entry.id, session.discordId, { appeal: true })
  if (r === 'ok') return out({ ok: true }, 201)
  if (r === 'too_soon') {
    const { appealCooldownDays: days } = await loadDisavowRules()
    return out({ error: `You can appeal once every ${days} days`, code: 'TOO_SOON', days }, 429)
  }
  if (r === 'already_open') return out({ error: 'A vote is already open' }, 409)
  return out({ error: 'Cannot appeal now' }, 409)
})
