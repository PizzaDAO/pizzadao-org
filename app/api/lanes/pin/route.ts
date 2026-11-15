import { json, rejectUnsafeWrite } from '@/app/lib/admin-guard'
import { requireSession } from '@/app/lib/auth-guards'
import { lanesEnabled, pinLane, type LaneSource } from '@/app/lib/lanes'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SOURCES: readonly LaneSource[] = ['card', 'dashboard', 'guide']

/**
 * POST /api/lanes/pin {slug, source?}: make a published lane the member's pinned lane
 * (plans/lane-cards-mission-onboarding.md). Idempotent; the latest pin wins. 404 while the lane
 * cards setting is off, 401 without a session, 404 for an unknown or unpublished lane.
 */
export async function POST(request: Request) {
  if (!(await lanesEnabled())) return json({ error: 'Not found' }, 404)
  const auth = await requireSession()
  if (!auth.ok) return auth.response
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!b || typeof b.slug !== 'string') return json({ error: 'slug is required' }, 400)
  const source = SOURCES.includes(b.source as LaneSource) ? (b.source as LaneSource) : 'guide'
  const ok = await pinLane(auth.session.discordId, b.slug, source)
  if (!ok) return json({ error: 'Not found' }, 404)
  return json({ ok: true, slug: b.slug })
}
