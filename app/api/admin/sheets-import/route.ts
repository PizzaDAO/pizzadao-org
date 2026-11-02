import { requireDpr, json } from '@/app/lib/admin-guard'
import { sheetsOverview } from '@/app/lib/sheets-import/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/sheets-import
 * Dread Pizza Roberts only. Every importable data set, where each one reads from right now, and
 * its last dry run and apply (counts only).
 */
export async function GET() {
  const auth = await requireDpr()
  if (!auth.ok) return auth.response
  try {
    return json(await sheetsOverview())
  } catch (e) {
    console.error('[sheets-import] overview failed', e instanceof Error ? e.message : e)
    return json({ error: 'Could not load the import overview' }, 500)
  }
}
