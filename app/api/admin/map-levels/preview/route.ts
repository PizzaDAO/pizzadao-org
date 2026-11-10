import { requireDpr, json } from '@/app/lib/admin-guard'
import { loadSettings } from '@/app/lib/settings'
import { computeAdminPreview } from '@/app/lib/map-levels/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/map-levels/preview
 * Dread Pizza Roberts only, never cached. Computed with the saved settings and works while the public
 * switch is off. Carries summed scores, exact counts and the City text members typed (no names or ids),
 * so it must never be reachable without the admin check.
 */
export async function GET() {
  const auth = await requireDpr()
  if (!auth.ok) return auth.response
  try {
    return json(await computeAdminPreview(await loadSettings()))
  } catch (e) {
    console.error('[map-levels] preview failed', e instanceof Error ? e.message : e)
    return json({ error: 'Could not compute the preview' }, 500)
  }
}
