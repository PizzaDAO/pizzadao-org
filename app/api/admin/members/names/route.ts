import { requireDpr, rejectUnsafeWrite, json } from '@/app/lib/admin-guard'
import { buildNameReport, sendNameReminders } from '@/app/lib/members/name-reminders'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

/** GET /api/admin/members/names: members whose display name is not themed. Dread Pizza Roberts only. */
export async function GET() {
  const auth = await requireDpr()
  if (!auth.ok) return auth.response
  return json(await buildNameReport())
}

/** POST /api/admin/members/names { memberIds: string[] }: DM the name reminder. Admin-triggered only. */
export async function POST(request: Request) {
  const auth = await requireDpr()
  if (!auth.ok) return auth.response
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  let body: { memberIds?: unknown }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }
  const ids = Array.isArray(body.memberIds) ? body.memberIds.filter((x): x is string => typeof x === 'string') : []
  if (!ids.length || ids.length > 100) return json({ error: 'Select between 1 and 100 members' }, 400)
  return json(await sendNameReminders([...new Set(ids)], auth.session.discordId))
}
