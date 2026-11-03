// app/api/followups/inbound/route.ts
//
// POST { senderId, text?, kind?, externalKey? }: a trusted service forwards a direct message that
// might be a reply to a follow-up. Authorization: Bearer <key>; the key decides the source. Answers
// { claimed, ack?, duplicate? }. Production only (previews share the database).

import { after, NextResponse } from 'next/server'
import { inboundSource } from '@/app/lib/followups/inbound-auth'
import { handleInbound } from '@/app/lib/followups/inbound'
import { notifyApprovers } from '@/app/lib/followups/notify'
import { checkKeyedRateLimit, rateLimitResponse } from '@/app/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'private, no-store' }
const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: NO_STORE })

export async function POST(request: Request) {
  if (process.env.VERCEL_ENV !== 'production') return json({ error: 'unavailable' }, 503)
  const source = inboundSource(request.headers.get('authorization'))
  if (!source) return json({ error: 'unauthorized' }, 401)

  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!b || typeof b !== 'object') return json({ error: 'bad-request' }, 400)
  const kind = b.kind === undefined ? 'text' : b.kind
  const text = b.text === undefined ? '' : b.text
  const externalKey = b.externalKey
  if (typeof b.senderId !== 'string' || !/^\d{1,25}$/.test(b.senderId)) return json({ error: 'bad-request' }, 400)
  if (kind !== 'text' && kind !== 'photo') return json({ error: 'bad-request' }, 400)
  if (typeof text !== 'string' || text.length > 4000) return json({ error: 'bad-request' }, 400)
  if (externalKey !== undefined && (typeof externalKey !== 'string' || externalKey.length === 0 || externalKey.length > 120)) return json({ error: 'bad-request' }, 400)

  const limited = await checkKeyedRateLimit('followup-inbound', `${source}:${b.senderId}`)
  if (!limited.success) return rateLimitResponse(limited)

  const r = await handleInbound({ source, senderId: b.senderId, text, kind, ...(externalKey ? { externalKey } : {}) }).catch((e) => {
    // Never log message text.
    console.error('[followup inbound] failed:', e instanceof Error ? e.message.slice(0, 160) : 'error')
    return null
  })
  if (!r) return json({ error: 'error' }, 500)
  if (r.notify) {
    const t = r.notify
    after(() => notifyApprovers(t).catch(() => 0))
  }
  return json({ claimed: r.claimed, ...(r.duplicate ? { duplicate: true } : {}), ...(r.ack !== undefined ? { ack: r.ack } : {}) })
}
