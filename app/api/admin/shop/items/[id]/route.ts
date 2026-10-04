// PATCH  /api/admin/shop/items/:id  edit (full form + expectedQuantity, optional reason)
// DELETE /api/admin/shop/items/:id  hard delete; 409 if the item was ever
//                                   bought, held or granted (hide it instead)
// Shop admins only.
import { jsonBody, shopAdminRoute } from '@/app/lib/shop-admin-route'
import { deleteShopItem, updateShopItem, validateItemId } from '@/app/lib/shop-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const PATCH = shopAdminRoute(async (req, session, ctx) => {
  const id = validateItemId((await ctx.params).id)
  return { item: await updateShopItem(session.discordId, id, await jsonBody(req)) }
})

export const DELETE = shopAdminRoute(async (_req, session, ctx) => {
  const id = validateItemId((await ctx.params).id)
  return deleteShopItem(session.discordId, id)
})
