import { disavowEnabled } from '@/app/lib/disavow/constants'
import { disavowNotFound } from '@/app/lib/disavow/access'
import { getSession } from '@/app/lib/session'
import { isAdminDiscordId } from '@/app/lib/auth-guards'
import { out, safe, type Ctx } from '@/app/lib/disavow/http'
import { redact } from '@/app/lib/disavow/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/disavow/[id]/redact { confirm: true } — admins only, for legal or
 * erasure requests. Overwrites text and identifiers; keeps the row and audit
 * trail. Anyone who is not an admin gets the same 404 as the rest of the list.
 */
export const POST = safe('redact', async (request: Request, ctx: Ctx) => {
  if (!(await disavowEnabled())) return disavowNotFound()
  const session = await getSession().catch(() => null)
  if (!session?.discordId || !(await isAdminDiscordId(session.discordId))) return disavowNotFound()
  const body = (await request.json().catch(() => null)) as { confirm?: unknown } | null
  if (body?.confirm !== true) return out({ error: 'Confirmation required' }, 400)
  const { id } = await ctx.params
  const r = await redact(id, session.discordId)
  if (r === 'not_found') return disavowNotFound()
  if (r === 'conflict') return out({ error: 'You cannot redact an entry about yourself' }, 403)
  return out({ ok: true })
})
