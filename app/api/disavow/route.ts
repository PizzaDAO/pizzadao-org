import { enforceRateLimit } from '@/app/lib/rate-limit'
import { requireDisavowViewer } from '@/app/lib/disavow/access'
import { listDisavowals } from '@/app/lib/disavow/detail'
import { out, safe } from '@/app/lib/disavow/http'
import { identifiersForMember } from '@/app/lib/disavow/match'
import { nominate } from '@/app/lib/disavow/store'
import { parseNomination, readJson } from '@/app/lib/disavow/validate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/disavow?tab=listed&page=1 — paginated list (404 unless eligible). */
export const GET = safe('list', async (request: Request) => {
  const g = await requireDisavowViewer()
  if (!g.ok) return g.response
  const url = new URL(request.url)
  return out(await listDisavowals(url.searchParams.get('tab'), url.searchParams.get('page'), g.isDPR))
})

/** POST /api/disavow — nominate (level 5+ or DPR). */
export const POST = safe('nominate', async (request: Request) => {
  const g = await requireDisavowViewer()
  if (!g.ok) return g.response
  const limited = await enforceRateLimit(request, 'disavow-nominate')
  if (limited) return limited

  const parsed = parseNomination(await readJson(request))
  if (!parsed.ok) return out({ error: parsed.error }, 400)

  // A picked member expands to every handle we know (Discord id, wallets, X),
  // so the listing follows them. Done server-side; the client never sees these.
  const merged = [...parsed.value.identifiers]
  for (const i of parsed.value.identifiers.filter(i => i.kind === 'MEMBER_ID')) {
    for (const extra of await identifiersForMember(i.value)) {
      if (!merged.some(m => m.kind === extra.kind && m.value === extra.value)) merged.push(extra)
    }
  }

  const r = await nominate({ nominatorDiscordId: g.session.discordId, ...parsed.value, identifiers: merged })
  if (r.ok) return out({ id: r.id }, 201)
  if (r.code === 'rate_limited') return out({ error: 'Nomination limit reached', code: 'LIMIT' }, 429)
  if (r.code === 'self') return out({ error: 'You cannot nominate yourself' }, 400)
  return out({ error: 'Already nominated or listed', existingId: r.existingId }, 409)
})
