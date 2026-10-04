// POST /api/admin/shop/items/:id/visibility { visible: boolean, reason? }
// Hide an item from the shop (or show it again). Shop admins only.
import { jsonBody, shopAdminRoute } from '@/app/lib/shop-admin-route'
import { setShopItemVisibility, validateItemId } from '@/app/lib/shop-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = shopAdminRoute(async (req, session, ctx) => {
  const id = validateItemId((await ctx.params).id)
  const body = await jsonBody(req)
  return { item: await setShopItemVisibility(session.discordId, id, body.visible as boolean, body.reason) }
})
