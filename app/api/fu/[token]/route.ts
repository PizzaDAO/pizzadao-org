// app/api/fu/[token]/route.ts
//
// POST { text? , undo? }: run the action a signed follow-up link names (links.ts). The page only
// ever shows a confirm button; nothing changes until this POST. There is no GET on purpose, so link
// previews and prefetchers cannot mark things done or opt anyone out.

import { after, NextResponse } from 'next/server'
import { rejectUnsafeWrite } from '@/app/lib/admin-guard'
import { performLinkAction } from '@/app/lib/followups/link-actions'
import { notifyApprovers } from '@/app/lib/followups/notify'
import { checkKeyedRateLimit, checkRateLimit, rateLimitResponse } from '@/app/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ token: string }> }

const NO_STORE = { 'Cache-Control': 'private, no-store' }
const reply = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: NO_STORE })

export async function POST(request: Request, ctx: Ctx) {
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  const { token } = await ctx.params

  const byIp = await checkRateLimit(request, 'followup-link-ip')
  if (!byIp.success) return rateLimitResponse(byIp)
  const byToken = await checkKeyedRateLimit('followup-link-token', token)
  if (!byToken.success) return rateLimitResponse(byToken)

  const b = (await request.json().catch(() => null)) as { text?: unknown; undo?: unknown } | null
  const r = await performLinkAction(token, { text: typeof b?.text === 'string' ? b.text : undefined, undo: b?.undo === true }).catch((e) => {
    console.error('[followup link] failed:', e instanceof Error ? e.message.slice(0, 160) : 'error')
    return null
  })
  if (!r) return reply({ ok: false, reason: 'error' }, 500)
  if (!r.ok) return reply({ ok: false, reason: r.reason }, r.reason === 'invalid' || r.reason === 'expired' || r.reason === 'not-found' ? 404 : r.reason === 'empty' ? 400 : 409)
  if ('notify' in r && r.notify) {
    const text = r.notify
    after(() => notifyApprovers(text).catch(() => 0))
  }
  return reply({ ok: true, kind: r.kind, ...('until' in r && r.until ? { until: r.until.toISOString() } : {}) })
}
