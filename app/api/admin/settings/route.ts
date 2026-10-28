import { requireDpr, rejectUnsafeWrite, json, isNonProductionDeploy } from '@/app/lib/admin-guard'
import { isSettingKey, parseSetting } from '@/app/lib/settings/registry'
import { confirmationFor, listChanges, listSettingViews, resetSetting, saveSetting, SettingError } from '@/app/lib/settings/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET / PUT / DELETE /api/admin/settings
 * Dread Pizza Roberts only (pinned role, never a setting). Never cached. Values are validated by
 * the registry on write (bounds, stricter-only), and a change that needs confirmation is refused
 * with 409 until the body carries `confirm: true`.
 *
 *   GET                         settings + recent changes (?history=<key> for one setting)
 *   PUT    {key, value, note?, expectedUpdatedAt?, confirm?}
 *   DELETE {key, note?}         back to the code default
 */
export async function GET(request: Request) {
  const auth = await requireDpr()
  if (!auth.ok) return auth.response
  const history = new URL(request.url).searchParams.get('history')
  if (history) {
    if (!isSettingKey(history)) return json({ error: 'Unknown setting' }, 400)
    return json({ changes: await listChanges({ key: history, limit: 50 }) })
  }
  const [settings, changes] = await Promise.all([listSettingViews(), listChanges({ limit: 50 })])
  return json({ settings, changes, nonProduction: isNonProductionDeploy() })
}

async function body(request: Request): Promise<Record<string, unknown> | null> {
  const b = (await request.json().catch(() => null)) as unknown
  return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : null
}

export async function PUT(request: Request) {
  const auth = await requireDpr()
  if (!auth.ok) return auth.response
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  const b = await body(request)
  if (!b || typeof b.key !== 'string' || !isSettingKey(b.key)) return json({ error: 'Unknown setting' }, 400)
  const key = b.key
  const parsed = parseSetting(key, b.value)
  if (!parsed.ok) return json({ error: `${key}: ${parsed.error}` }, 400)
  try {
    const current = (await listSettingViews()).find((s) => s.key === key)
    const ask = confirmationFor(key, current?.value, parsed.value)
    if (ask && b.confirm !== true) return json({ error: 'Confirmation required', needsConfirm: ask }, 409)
    const expected = typeof b.expectedUpdatedAt === 'string' ? b.expectedUpdatedAt : b.expectedUpdatedAt === null ? null : undefined
    const saved = await saveSetting(key, parsed.value, auth.session.discordId, { note: b.note, expectedUpdatedAt: expected })
    return json({ ok: true, updatedAt: saved.updatedAt.toISOString() })
  } catch (e) {
    if (e instanceof SettingError) return json({ error: e.message }, e.status)
    console.error('[admin settings] save failed:', e)
    return json({ error: 'Could not save the setting' }, 500)
  }
}

export async function DELETE(request: Request) {
  const auth = await requireDpr()
  if (!auth.ok) return auth.response
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  const b = await body(request)
  if (!b || typeof b.key !== 'string' || !isSettingKey(b.key)) return json({ error: 'Unknown setting' }, 400)
  try {
    // The default is always the reviewed code value, never looser than the registry bounds allow.
    const removed = await resetSetting(b.key, auth.session.discordId, { note: b.note })
    return json({ ok: true, removed })
  } catch (e) {
    console.error('[admin settings] reset failed:', e)
    return json({ error: 'Could not reset the setting' }, 500)
  }
}
