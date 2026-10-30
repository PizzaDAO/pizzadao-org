import { requireDpr, json } from '@/app/lib/admin-guard'
import { loadAdminOverview } from '@/app/lib/telegram/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/admin/telegram: the city mirror outbox, directory and switch status. Dread Pizza Roberts only. */
export async function GET() {
  const auth = await requireDpr()
  if (!auth.ok) return auth.response
  try {
    return json(await loadAdminOverview())
  } catch (e) {
    console.error('[admin telegram] failed:', e instanceof Error ? e.message.slice(0, 200) : 'error')
    return json({ error: 'Something went wrong' }, 500)
  }
}
