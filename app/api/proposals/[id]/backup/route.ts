import { rejectUnsafeWrite } from '@/app/lib/admin-guard'
import { out, requireProposalsSession, safe, type RouteCtx } from '@/app/lib/proposals/http'
import { getBallotBlob, saveBallotBlob } from '@/app/lib/proposals/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Wallet-backed ballot backup. The body is ONLY the ciphertext: the key is derived in the browser from a wallet
 * signature, which is never sent here, so the server cannot read the backup.
 */
export const GET = safe('backup-get', async (_request: Request, { params }: RouteCtx) => {
  const auth = await requireProposalsSession()
  if (!auth.ok) return auth.response
  const { id } = await params
  const r = await getBallotBlob(id, auth.session.discordId)
  if (!r.eligible) return out({ error: 'not_eligible' }, 403)
  return out({ blob: r.blob })
})

export const PUT = safe('backup-put', async (request: Request, { params }: RouteCtx) => {
  const auth = await requireProposalsSession()
  if (!auth.ok) return auth.response
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  const { id } = await params
  const body = (await request.json().catch(() => null)) as { blob?: unknown } | null
  const r = await saveBallotBlob(id, auth.session.discordId, body?.blob)
  if (r === 'ok') return out({ ok: true })
  return out({ error: r }, r === 'not_eligible' ? 403 : 400)
})
