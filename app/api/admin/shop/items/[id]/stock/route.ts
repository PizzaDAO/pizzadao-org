// POST /api/admin/shop/items/:id/stock { delta: +n (restock) | -n (adjust down), reason }
// Shop admins only.
import { jsonBody, shopAdminRoute } from '@/app/lib/shop-admin-route'
import { adjustShopItemStock, validateItemId } from '@/app/lib/shop-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = shopAdminRoute(async (req, session, ctx) => {
  const id = validateItemId((await ctx.params).id)
  const body = await jsonBody(req)
  return { item: await adjustShopItemStock(session.discordId, id, body.delta, body.reason) }
})
