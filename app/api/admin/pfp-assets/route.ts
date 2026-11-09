// GET  /api/admin/pfp-assets: the catalog, rule-editor options, grants and recent changes.
// POST /api/admin/pfp-assets: create an asset (starts inactive unless isActive: true).
// Dread Pizza Roberts only (pfpAdminRoute).
import { pfpAdminRoute, jsonBody } from '@/app/lib/pfp-assets/admin-route'
import { createAsset, listAssets, listGrants, loadRuleOptions, recentEvents } from '@/app/lib/pfp-assets/catalog'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = pfpAdminRoute(async () => {
  const [assets, options, grants, events] = await Promise.all([listAssets(), loadRuleOptions(), listGrants(), recentEvents()])
  return { assets, options, grants, events }
})

export const POST = pfpAdminRoute(async (req, session) => {
  const asset = await createAsset(await jsonBody(req), session.discordId)
  return { asset }
})
