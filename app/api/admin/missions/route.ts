import { requireDpr, rejectUnsafeWrite, json, isNonProductionDeploy } from '@/app/lib/admin-guard'
import { listAdminLevels, MissionEditError, updateLevel, updateMission } from '@/app/lib/admin-missions'
import { listChanges } from '@/app/lib/settings/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET / PATCH /api/admin/missions
 * Dread Pizza Roberts only. Stricter-only: numeric minimums can be raised, rewards lowered, a
 * mission re-activated (never deactivated); other params are read-only. Also level titles and
 * mission titles/descriptions. No creating or
 * deleting missions, and no changing a mission's verifier. Never cached.
 *
 *   GET                                         levels + missions + recent changes
 *   PATCH {missionId, title?, description?, guideHref?, isActive?, verifierParams?, note?, confirm?}
 *   PATCH {level, reward?, levelTitle?, note?, confirm?}
 */
export async function GET() {
  const auth = await requireDpr()
  if (!auth.ok) return auth.response
  const [levels, changes] = await Promise.all([listAdminLevels(), listChanges({ limit: 100 })])
  return json({ levels, changes: changes.filter((c) => c.key.startsWith('mission:') || c.key.startsWith('missionLevel:')), nonProduction: isNonProductionDeploy() })
}

export async function PATCH(request: Request) {
  const auth = await requireDpr()
  if (!auth.ok) return auth.response
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!b || typeof b !== 'object' || Array.isArray(b)) return json({ error: 'Invalid body' }, 400)
  const opts = { confirm: b.confirm === true, note: b.note }
  try {
    if (b.missionId !== undefined) {
      if (typeof b.missionId !== 'number') return json({ error: 'missionId must be a number' }, 400)
      const r = await updateMission(
        b.missionId,
        { title: b.title, description: b.description, guideHref: b.guideHref, isActive: b.isActive, verifierParams: b.verifierParams },
        auth.session.discordId,
        opts,
      )
      return json({ ok: true, ...r })
    }
    if (b.level !== undefined) {
      if (typeof b.level !== 'number') return json({ error: 'level must be a number' }, 400)
      const r = await updateLevel(b.level, { reward: b.reward, levelTitle: b.levelTitle }, auth.session.discordId, opts)
      return json({ ok: true, ...r })
    }
    return json({ error: 'missionId or level is required' }, 400)
  } catch (e) {
    if (e instanceof MissionEditError) {
      return json({ error: e.message, ...(e.needsConfirm ? { needsConfirm: e.needsConfirm } : {}) }, e.status)
    }
    console.error('[admin missions] save failed:', e)
    return json({ error: 'Could not save the change' }, 500)
  }
}
