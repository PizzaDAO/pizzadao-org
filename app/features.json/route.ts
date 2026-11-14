import { exportResponse } from '@/app/lib/features/export-response'
import { toJson } from '@/app/lib/features/exports'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /features.json: the published catalog, machine-readable. 404 while features.exportEnabled is off. */
export async function GET() {
  return exportResponse((c, o) => JSON.stringify(toJson(c, o), null, 2), 'application/json; charset=utf-8')
}
