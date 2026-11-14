import { exportResponse } from '@/app/lib/features/export-response'
import { toMarkdown } from '@/app/lib/features/exports'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /features.md: the published catalog as Markdown for agents. 404 while features.exportEnabled is off. */
export async function GET() {
  return exportResponse(toMarkdown, 'text/markdown; charset=utf-8')
}
