import { requireDpr, json } from '@/app/lib/admin-guard'
import { findDataset } from '@/app/lib/sheets-import/datasets'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

type Params = { params: Promise<{ dataset: string }> }

/**
 * GET /api/admin/sheets-import/<dataset>/parity
 * Dread Pizza Roberts only. Runs the real read path in sheet mode and in database mode and returns
 * counts of differences, never contents. Must be 0 (or explained) before switching to "db".
 */
export async function GET(_request: Request, { params }: Params) {
  const auth = await requireDpr()
  if (!auth.ok) return auth.response
  const { dataset } = await params
  const info = findDataset(dataset)
  if (!info) return json({ error: 'Unknown data set' }, 404)
  if (!info.parity) return json({ error: 'No parity check for this data set' }, 404)
  try {
    return json(await info.parity())
  } catch (e) {
    console.error('[sheets-import] parity failed', dataset, e instanceof Error ? e.message : e)
    return json({ dataset, error: 'Parity check failed' }, 502)
  }
}
