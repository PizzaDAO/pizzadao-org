import { after } from 'next/server'
import { enforceRateLimit } from '@/app/lib/rate-limit'
import { requireDisavowViewer } from '@/app/lib/disavow/access'
import { listDisavowals } from '@/app/lib/disavow/detail'
import { out, safe } from '@/app/lib/disavow/http'
import { resolveSubjectIdentifiers } from '@/app/lib/disavow/match'
import { listMySubmissions, nominate } from '@/app/lib/disavow/store'
import { parseNomination, readJson } from '@/app/lib/disavow/validate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/disavow?tab=listed&page=1 — paginated list (404 unless eligible). */
export const GET = safe('list', async (request: Request) => {
  const g = await requireDisavowViewer()
  if (!g.ok) return g.response
  const url = new URL(request.url)
  if (url.searchParams.get('tab') === 'mine') return out({ tab: 'mine', items: await listMySubmissions(g.session.discordId) })
  return out(await listDisavowals(url.searchParams.get('tab'), url.searchParams.get('page'), g.isDPR, g.session.discordId))
})

/** POST /api/disavow — nominate (level 5+ or DPR). */
export const POST = safe('nominate', async (request: Request) => {
  const g = await requireDisavowViewer()
  if (!g.ok) return g.response
  const limited = await enforceRateLimit(request, 'disavow-nominate')
  if (limited) return limited

  const parsed = parseNomination(await readJson(request))
  if (!parsed.ok) return out({ error: parsed.error }, 400)

  // Whatever was typed (a wallet, an X handle, a Discord id, a picked member) expands
  // server-side to the member behind it, so the entry also carries their member id,
  // Discord id, wallets and X handle and the subject can't slip past the checks.
  const merged = await resolveSubjectIdentifiers(parsed.value.identifiers)

  const r = await nominate({
    nominatorDiscordId: g.session.discordId, ...parsed.value, identifiers: merged,
    // DPR notifications (and their lookups) run after the response, so a new
    // nomination and a duplicate of a hidden entry answer in about the same time.
    defer: work => { after(work) },
  })
  // Non-DPR callers get the same answer whether a nomination was created or an
  // active NOMINATED/SUSPENDED entry already existed (which would otherwise leak
  // that a nomination exists). Only an existing LISTED entry is revealed, and
  // they can see those anyway.
  if (r.ok) return out({ ok: true, ...(g.isDPR ? { id: r.id } : {}) }, 201)
  if (r.code === 'rate_limited') return out({ error: 'Nomination limit reached', code: 'LIMIT' }, 429)
  if (r.code === 'self') return out({ error: 'You cannot nominate yourself' }, 400)
  if (g.isDPR || r.existingStatus === 'LISTED') {
    return out({ error: 'Already nominated or listed', existingId: r.existingId }, 409)
  }
  return out({ ok: true }, 201)
})
