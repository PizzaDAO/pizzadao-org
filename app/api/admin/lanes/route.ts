import { requireDpr, rejectUnsafeWrite, json, isNonProductionDeploy } from '@/app/lib/admin-guard'
import { createStep, deleteStep, LaneEditError, listAdminLanes, moveStep, updateLane, updateStep } from '@/app/lib/lanes/admin'
import { listChanges } from '@/app/lib/settings/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET / PATCH / POST / DELETE /api/admin/lanes
 * Dread Pizza Roberts only (plans/lane-cards-mission-onboarding.md). Never cached. Works whether or
 * not the public toggle is on.
 *
 *   GET                                                    lanes + steps, mission options, recent changes
 *   PATCH  {slug, tag?, title?, summary?, missionId?, stretchMissionIds?, crewId?, published?, note?}
 *   PATCH  {stepId, title?, body?, linkHref?, linkLabel?, kind?, note?}
 *   PATCH  {stepId, move: "up" | "down"}
 *   POST   {slug, title, body?, linkHref?, linkLabel?, kind?, note?}   add a step at the end
 *   DELETE {stepId, note?}
 */
export async function GET() {
  const auth = await requireDpr()
  if (!auth.ok) return auth.response
  const [data, changes] = await Promise.all([listAdminLanes(), listChanges({ limit: 100 })])
  return json({ ...data, changes: changes.filter((c) => c.key.startsWith('lane:') || c.key.startsWith('laneStep:')), nonProduction: isNonProductionDeploy() })
}

async function guarded(request: Request, run: (b: Record<string, unknown>, actor: string) => Promise<Response>): Promise<Response> {
  const auth = await requireDpr()
  if (!auth.ok) return auth.response
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!b || typeof b !== 'object' || Array.isArray(b)) return json({ error: 'Invalid body' }, 400)
  try {
    return await run(b, auth.session.discordId)
  } catch (e) {
    if (e instanceof LaneEditError) return json({ error: e.message }, e.status)
    console.error('[admin lanes] save failed:', e)
    return json({ error: 'Could not save the change' }, 500)
  }
}

export function PATCH(request: Request) {
  return guarded(request, async (b, actor) => {
    if (typeof b.stepId === 'string') {
      if (b.move !== undefined) {
        await moveStep(b.stepId, b.move as 'up' | 'down', actor)
        return json({ ok: true })
      }
      const r = await updateStep(b.stepId, { title: b.title, body: b.body, linkHref: b.linkHref, linkLabel: b.linkLabel, kind: b.kind }, actor, b.note)
      return json({ ok: true, ...r })
    }
    if (typeof b.slug === 'string') {
      const r = await updateLane(
        b.slug,
        { tag: b.tag, title: b.title, summary: b.summary, missionId: b.missionId, stretchMissionIds: b.stretchMissionIds, crewId: b.crewId, published: b.published },
        actor,
        b.note,
      )
      return json({ ok: true, ...r })
    }
    return json({ error: 'slug or stepId is required' }, 400)
  })
}

export function POST(request: Request) {
  return guarded(request, async (b, actor) => {
    if (typeof b.slug !== 'string') return json({ error: 'slug is required' }, 400)
    const r = await createStep(b.slug, { title: b.title, body: b.body, linkHref: b.linkHref, linkLabel: b.linkLabel, kind: b.kind }, actor, b.note)
    return json({ ok: true, ...r }, 201)
  })
}

export function DELETE(request: Request) {
  return guarded(request, async (b, actor) => {
    if (typeof b.stepId !== 'string') return json({ error: 'stepId is required' }, 400)
    await deleteStep(b.stepId, actor, b.note)
    return json({ ok: true })
  })
}
