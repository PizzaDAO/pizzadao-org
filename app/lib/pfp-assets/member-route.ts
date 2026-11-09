// Guard for the member-facing PFP composer API: a signed-in session that resolves to a member
// row (members only). The owner is always the session's own member; no id is taken from the client.
import { NextResponse } from 'next/server'
import { requireSession } from '@/app/lib/auth-guards'
import { rejectCrossOrigin, rejectUnsafeWrite } from '@/app/lib/admin-guard'
import { fetchMemberIdByDiscordId } from '@/app/lib/sheets/member-repository'
import { handleApiError } from '@/app/lib/errors/error-response'
import { NO_STORE_HEADERS } from '@/app/lib/no-store'

export type MemberCtx = { discordId: string; memberId: string }

export function memberPfpRoute(
  handler: (req: Request, who: MemberCtx) => Promise<unknown>,
  opts: { multipart?: boolean } = {},
) {
  return async (req: Request): Promise<NextResponse> => {
    const auth = await requireSession()
    if (!auth.ok) return auth.response
    const discordId = auth.session.discordId
    const memberId = await fetchMemberIdByDiscordId(discordId).catch(() => null)
    if (!memberId) return NextResponse.json({ error: 'Members only' }, { status: 403, headers: NO_STORE_HEADERS })
    if (req.method !== 'GET') {
      const bad = opts.multipart ? rejectCrossOrigin(req) : rejectUnsafeWrite(req)
      if (bad) return bad
    }
    try {
      return NextResponse.json(await handler(req, { discordId, memberId }), { headers: NO_STORE_HEADERS })
    } catch (e) {
      const res = handleApiError(e)
      for (const [k, v] of Object.entries(NO_STORE_HEADERS)) res.headers.set(k, v)
      return res
    }
  }
}
