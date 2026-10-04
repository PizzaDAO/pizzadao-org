// GET /api/admin/shop/holding?recipient=<member ID or Discord ID>&itemId=<id>
// Who that is and how many of the item they hold (and have pending), so the
// grant / remove form can confirm before acting. Shop admins only.
import { shopAdminRoute } from '@/app/lib/shop-admin-route'
import { getMemberHolding, validateItemId } from '@/app/lib/shop-admin'
import { resolvePepRecipient } from '@/app/lib/pep-recipient'
import { prisma } from '@/app/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = shopAdminRoute(async (req) => {
  const url = new URL(req.url)
  const itemId = validateItemId(url.searchParams.get('itemId'))
  const discordId = await resolvePepRecipient(url.searchParams.get('recipient'))
  const [holding, user] = await Promise.all([
    getMemberHolding(discordId, itemId),
    prisma.user.findUnique({ where: { id: discordId }, select: { id: true } }),
  ])
  return { discordId, hasAccount: !!user, ...holding }
})
