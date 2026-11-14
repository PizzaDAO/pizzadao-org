/** Shared handler for the three export routes: 404 while `features.exportEnabled` is off, else the formatted catalog. */
import { marketingIndexable } from '@/app/lib/marketing-site'
import { SITE_URL } from '@/app/lib/site-url'
import { getPublicCatalog, loadSwitches } from './service'
import type { PublicCatalog } from './types'

const CACHE = 'public, s-maxage=300, stale-while-revalidate=600'

export async function exportResponse(
  format: (catalog: PublicCatalog, o: { siteUrl: string }) => string,
  contentType: string,
): Promise<Response> {
  try {
    // The switch is read first and the rows only after, so a switched-off export never touches the data.
    if (!(await loadSwitches()).exportEnabled) return new Response('Not found', { status: 404 })
    const { catalog } = await getPublicCatalog({ withCommits: true })
    const headers: Record<string, string> = { 'Content-Type': contentType, 'Cache-Control': CACHE }
    // Like the marketing pages, the exports stay out of search results until the domain move.
    if (!marketingIndexable()) headers['X-Robots-Tag'] = 'noindex'
    return new Response(format(catalog, { siteUrl: SITE_URL }), { headers })
  } catch (e) {
    console.error('[features] export failed', e instanceof Error ? e.message : e)
    return new Response('Unavailable', { status: 503 })
  }
}
