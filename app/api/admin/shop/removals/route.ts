// POST /api/admin/shop/removals { recipient, itemId, quantity, reason }
// Take units of an item out of a member's inventory (never below 0).
// `recipient` is a PizzaDAO member ID or a Discord ID. Shop admins only.
import { jsonBody, shopAdminRoute } from '@/app/lib/shop-admin-route'
import { adminRemoveItem, validateItemId } from '@/app/lib/shop-admin'
import { resolvePepRecipient } from '@/app/lib/pep-recipient'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = shopAdminRoute(async (req, session) => {
  const body = await jsonBody(req)
  const itemId = validateItemId(body.itemId)
  const discordId = await resolvePepRecipient(body.recipient)
  const result = await adminRemoveItem(session.discordId, {
    discordId,
    itemId,
    quantity: body.quantity,
    reason: body.reason,
  })
  return { ...result, discordId }
})
