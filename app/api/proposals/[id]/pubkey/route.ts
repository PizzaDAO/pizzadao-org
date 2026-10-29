import { out, requireEnabled, safe, type RouteCtx } from '@/app/lib/proposals/http'
import { getPublicKey } from '@/app/lib/proposals/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/proposals/[id]/pubkey — this proposal's PUBLIC voting key and its fingerprint (also shown on the page and in Discord). */
export const GET = safe('pubkey', async (_request: Request, { params }: RouteCtx) => {
  const off = await requireEnabled()
  if (off) return off
  const { id } = await params
  const key = await getPublicKey(id)
  if (!key) return out({ error: 'Not found' }, 404)
  return out(key)
})
