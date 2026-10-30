import { requireDpr, json, rejectUnsafeWrite } from '@/app/lib/admin-guard'
import { skipPost } from '@/app/lib/telegram/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/** POST { action: 'skip' }: stop a queued post from being sent. Dread Pizza Roberts only. */
export async function POST(request: Request, ctx: Ctx) {
  const auth = await requireDpr()
  if (!auth.ok) return auth.response
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  const body = (await request.json().catch(() => null)) as { action?: unknown } | null
  if (body?.action !== 'skip') return json({ error: 'Bad request' }, 400)
  try {
    const done = await skipPost((await ctx.params).id)
    return done ? json({ ok: true }) : json({ error: 'That post is not waiting any more' }, 409)
  } catch (e) {
    console.error('[admin telegram] skip failed:', e instanceof Error ? e.message.slice(0, 200) : 'error')
    return json({ error: 'Something went wrong' }, 500)
  }
}
