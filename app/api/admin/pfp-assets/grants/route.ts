// POST   /api/admin/pfp-assets/grants { assetId, discordId }: manual one-off grant.
// DELETE /api/admin/pfp-assets/grants { assetId, discordId }: revoke it.
import { pfpAdminRoute, jsonBody } from '@/app/lib/pfp-assets/admin-route'
import { grantAsset, revokeAsset } from '@/app/lib/pfp-assets/catalog'
import { ValidationError } from '@/app/lib/errors/api-errors'

function assetId(v: unknown): number {
  const n = Number(v)
  if (typeof v === 'boolean' || v === null || v === '' || !Number.isInteger(n) || n < 1) throw new ValidationError('assetId must be a whole number', 'assetId')
  return n
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = pfpAdminRoute(async (req, session) => {
  const b = await jsonBody(req)
  await grantAsset(assetId(b.assetId), b.discordId, session.discordId)
  return { ok: true }
})

export const DELETE = pfpAdminRoute(async (req, session) => {
  const b = await jsonBody(req)
  await revokeAsset(assetId(b.assetId), b.discordId, session.discordId)
  return { ok: true }
})
