// POST /api/admin/shop/grants { recipient, itemId, quantity, reason, requestId }
// Give a member an item. `recipient` is a PizzaDAO member ID or a Discord ID
// (resolved like PEP transfers, pep-recipient.ts). A member with no app account
// yet gets the grant held PENDING until they log in. `requestId` makes a
// retried submit land once. Shop admins only.
import { jsonBody, shopAdminRoute } from '@/app/lib/shop-admin-route'
import { adminGrantItem, validateItemId } from '@/app/lib/shop-admin'
import { resolvePepRecipient } from '@/app/lib/pep-recipient'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = shopAdminRoute(async (req, session) => {
  const body = await jsonBody(req)
  const itemId = validateItemId(body.itemId)
  const discordId = await resolvePepRecipient(body.recipient)
  const result = await adminGrantItem(session.discordId, {
    discordId,
    itemId,
    quantity: body.quantity,
    reason: body.reason,
    requestId: body.requestId,
  })
  return { ...result, discordId }
})
