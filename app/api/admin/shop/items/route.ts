// POST /api/admin/shop/items: create a shop item. Shop admins only.
// Body: { name, description?, price, quantity (-1 = unlimited), image?, isAvailable, isCollectible }
import { jsonBody, shopAdminRoute } from '@/app/lib/shop-admin-route'
import { createShopItem } from '@/app/lib/shop-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = shopAdminRoute(async (req, session) => ({
  item: await createShopItem(session.discordId, await jsonBody(req)),
}))
