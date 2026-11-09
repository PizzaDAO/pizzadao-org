// POST   /api/admin/pfp-assets/grants { assetId, discordId }: manual one-off grant.
// DELETE /api/admin/pfp-assets/grants { assetId, discordId }: revoke it.
import { pfpAdminRoute, jsonBody } from '@/app/lib/pfp-assets/admin-route'
import { grantAsset, revokeAsset } from '@/app/lib/pfp-assets/catalog'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = pfpAdminRoute(async (req, session) => {
  const b = await jsonBody(req)
  await grantAsset(Number(b.assetId), b.discordId, session.discordId)
  return { ok: true }
})

export const DELETE = pfpAdminRoute(async (req, session) => {
  const b = await jsonBody(req)
  await revokeAsset(Number(b.assetId), b.discordId, session.discordId)
  return { ok: true }
})
