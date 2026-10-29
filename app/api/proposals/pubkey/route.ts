import { out, requireEnabled, safe } from '@/app/lib/proposals/http'
import { publicKeyPem } from '@/app/lib/proposals/token'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/proposals/pubkey — the PUBLIC voting key (safe to expose), used by the browser to blind ballot tokens. */
export const GET = safe('pubkey', async () => {
  const off = await requireEnabled()
  if (off) return off
  const publicKey = publicKeyPem()
  if (!publicKey) return out({ error: 'Voting is not configured' }, 503)
  return out({ publicKey })
})
