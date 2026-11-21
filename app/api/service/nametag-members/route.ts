// app/api/service/nametag-members/route.ts
//
// POST { emailHashes?: hex64[], wallets?: 0x40[] }: rsv.pizza (a trusted service, Authorization: Bearer
// <NAMETAG_SERVICE_KEY>) asks which of its event guests are members, to print name tags. Answers
// { ok, matches: [{ emailHash?, wallet?, member }] } with allow-listed public fields only. Read-only, so
// previews can use it. Off (503) until the nametags.enabled setting is on, and closed with no key set.

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { nametagAuthorized, nametagKeyConfigured } from '@/app/lib/nametags/auth'
import { matchIdentifiers, HEX64, EVM_WALLET } from '@/app/lib/nametags/match'
import { composeNametagCards, loadNametagFields } from '@/app/lib/nametags/card'
import { getSetting } from '@/app/lib/settings'
import { checkKeyedRateLimit, rateLimitResponse } from '@/app/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'private, no-store' }
const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: NO_STORE })

const bodySchema = z.object({
  emailHashes: z.array(z.string().regex(HEX64)).default([]),
  wallets: z.array(z.string().regex(EVM_WALLET)).default([]),
})

export async function POST(request: Request) {
  if (!nametagKeyConfigured()) return json({ error: 'unavailable' }, 503)
  if (!nametagAuthorized(request.headers.get('authorization'))) return json({ error: 'unauthorized' }, 401)
  if ((await getSetting('nametags.enabled').catch(() => 0)) !== 1) return json({ error: 'disabled' }, 503)

  const limited = await checkKeyedRateLimit('nametag-members', 'rsv')
  if (!limited.success) return rateLimitResponse(limited)

  const raw = await request.json().catch(() => null)
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) return json({ error: 'bad-request' }, 400)
  const { emailHashes, wallets } = parsed.data
  if (emailHashes.length === 0 && wallets.length === 0) return json({ error: 'bad-request' }, 400)

  const [max, matchWallets] = await Promise.all([getSetting('nametags.maxIdentifiers'), getSetting('nametags.matchWallets')])
  if (emailHashes.length > max || wallets.length > max) return json({ error: 'too-many' }, 413)

  try {
    const matched = await matchIdentifiers({ emailHashes, wallets }, { matchWallets: matchWallets === 1 })
    const cards = await composeNametagCards(matched.map((m) => m.memberId), await loadNametagFields())
    const matches = matched.flatMap((m) => {
      const member = cards.get(m.memberId)
      if (!member) return []
      return [{ ...(m.emailHash ? { emailHash: m.emailHash } : {}), ...(m.wallet ? { wallet: m.wallet } : {}), member }]
    })
    return json({ ok: true, matches })
  } catch (e) {
    // Never log identifiers.
    console.error('[nametag-members] failed:', e instanceof Error ? e.message.slice(0, 160) : 'error')
    return json({ error: 'error' }, 500)
  }
}
