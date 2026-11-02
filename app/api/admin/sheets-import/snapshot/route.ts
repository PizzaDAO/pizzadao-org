import { requireDpr, rejectUnsafeWrite, json } from '@/app/lib/admin-guard'
import { takeSnapshot } from '@/app/lib/sheets-import/snapshot'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * POST /api/admin/sheets-import/snapshot   body: {}
 * Dread Pizza Roberts only. Copies every tab of every sheet the app uses into SheetSnapshot (the
 * in-database archive). Returns counts only.
 */
export async function POST(request: Request) {
  const auth = await requireDpr()
  if (!auth.ok) return auth.response
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  try {
    return json(await takeSnapshot(auth.session.discordId))
  } catch (e) {
    console.error('[sheets-import] snapshot failed', e instanceof Error ? e.message : e)
    return json({ error: 'Snapshot failed' }, 502)
  }
}
