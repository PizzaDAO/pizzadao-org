import { requireAdmin } from '@/app/lib/auth-guards'
import { json } from '@/app/lib/admin-guard'
import { prisma } from '@/app/lib/db'
import { loadSettings } from '@/app/lib/settings'
import { loadSwitches } from '@/app/lib/features/service'
import { settingIsOn } from '@/app/lib/features/switches'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/features
 * Admin only, never cached. Every app and feature row, published or not (with the last link check), plus the
 * live state of each row's switch so the editor can show what the public page would do.
 */
export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  try {
    const [settings, switches, apps, entries] = await Promise.all([
      loadSettings(),
      loadSwitches(),
      prisma.featureApp.findMany({ orderBy: [{ position: 'asc' }, { slug: 'asc' }] }),
      prisma.featureEntry.findMany({ orderBy: [{ position: 'asc' }, { slug: 'asc' }] }),
    ])
    const rows = entries.map((e) => ({ ...e, switchOn: e.toggleKey ? settingIsOn(e.toggleKey, settings) : null }))
    return json({ apps, entries: rows, switches })
  } catch (e) {
    console.error('[features] admin list failed', e instanceof Error ? e.message : e)
    return json({ error: 'Could not load the catalog' }, 500)
  }
}
