import { exportResponse } from '@/app/lib/features/export-response'
import { toLlmsTxt } from '@/app/lib/features/exports'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /llms.txt: a short index for AI agents pointing at the features exports. 404 while features.exportEnabled is off. */
export async function GET() {
  return exportResponse(toLlmsTxt, 'text/plain; charset=utf-8')
}
