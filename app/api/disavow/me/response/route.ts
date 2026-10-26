import { disavowEnabled } from '@/app/lib/disavow/constants'
import { disavowNotFound, findSubjectDisavowals } from '@/app/lib/disavow/access'
import { getSession } from '@/app/lib/session'
import { out, pickEntry, safe } from '@/app/lib/disavow/http'
import { addResponse } from '@/app/lib/disavow/store'
import { parseResponseText, readJson } from '@/app/lib/disavow/validate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST /api/disavow/me/response { text } — the listed member's reply (editable, logged). */
export const POST = safe('me-response', async (request: Request) => {
  if (!disavowEnabled()) return disavowNotFound()
  const session = await getSession().catch(() => null)
  if (!session?.discordId) return disavowNotFound()
  const mine = await findSubjectDisavowals(session.discordId)
  if (mine.length === 0) return disavowNotFound()
  const body = await readJson(request)
  const entry = pickEntry(mine, body)
  if (!entry) return out({ error: 'Choose which entry' }, 400)
  const parsed = parseResponseText(body)
  if (!parsed.ok) return out({ error: parsed.error }, 400)
  const r = await addResponse(entry.id, session.discordId, parsed.value)
  if (r !== 'ok') return out({ error: 'Cannot respond now' }, 409)
  return out({ ok: true })
})
