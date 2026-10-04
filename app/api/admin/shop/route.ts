// GET /api/admin/shop: every item (with units sold / held / pending), the
// latest shop admin audit rows, and display labels for the people in them.
// Shop admins only.
import { shopAdminRoute } from '@/app/lib/shop-admin-route'
import { getShopAdminOverview } from '@/app/lib/shop-admin'
import { eventPeople, labelPeople } from '@/app/lib/shop-admin-people'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = shopAdminRoute(async () => {
  const data = await getShopAdminOverview()
  return { ...data, people: await labelPeople(eventPeople(data.events)) }
})
