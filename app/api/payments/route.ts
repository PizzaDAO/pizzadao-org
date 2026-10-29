import { json, rejectUnsafeWrite } from '@/app/lib/admin-guard'
import { requireSession } from '@/app/lib/auth-guards'
import { parseNewRequest } from '@/app/lib/payments/app-form'
import { listMyRequests } from '@/app/lib/payments/mine'
import { loadPaymentPolicy } from '@/app/lib/payments/policy'
import { createPaymentRequest } from '@/app/lib/payments/store'
import { hostViewFor } from '@/app/lib/payments/trust-load'
import { checkKeyedRateLimit, rateLimitResponse } from '@/app/lib/rate-limit'
import { fetchMemberByDiscordId } from '@/app/lib/sheets/member-repository'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/payments — the signed-in member's own requests (status only; no flags or reviewer detail). */
export async function GET() {
  const auth = await requireSession()
  if (!auth.ok) return auth.response
  const policy = await loadPaymentPolicy()
  try {
    const [requests, fastTrack] = await Promise.all([
      listMyRequests(auth.session.discordId),
      // Progress only: never flags, blockers or the party-platform tier.
      policy.fastTrackEnabled ? hostViewFor(auth.session.discordId, policy).catch(() => null) : Promise.resolve(null),
    ])
    return json({ formEnabled: policy.requestFormEnabled, uploadsEnabled: policy.receiptUploadEnabled, fastTrack, requests })
  } catch (e) {
    console.error('[payments] list failed:', e instanceof Error ? e.message : e)
    return json({ error: 'Could not load your requests' }, 500)
  }
}

/**
 * POST /api/payments — file a payment request. Members only, and only while the
 * `payments.requestFormEnabled` setting is on. The payee reference is hashed and dropped. Receipts
 * are added afterwards through /api/payments/[id]/attachments (private storage, setting-gated).
 */
export async function POST(request: Request) {
  const auth = await requireSession()
  if (!auth.ok) return auth.response
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  const policy = await loadPaymentPolicy()
  if (!policy.requestFormEnabled) return json({ error: 'The request form is not open yet' }, 403)

  const limited = await checkKeyedRateLimit('payments-create', auth.session.discordId)
  if (!limited.success) return rateLimitResponse(limited)

  const parsed = parseNewRequest(await request.json().catch(() => null))
  if (!parsed.ok) return json({ error: parsed.error }, parsed.error === 'party_event' ? 422 : 400)

  try {
    const discordId = auth.session.discordId
    const member = await fetchMemberByDiscordId(discordId).catch(() => null)
    // Members only: a signed-in Discord account that is not in the member list cannot file requests.
    if (!member?.memberId) return json({ error: 'Only members can file payment requests' }, 403)
    const label = (member?.name || auth.session.nick || auth.session.username || 'Member').slice(0, 100)
    const { id } = await createPaymentRequest(
      { ...parsed.data, requesterDiscordId: discordId, claimedDiscordId: null, requesterMemberId: member.memberId, requesterLabel: label },
      policy,
    )
    return json({ ok: true, id }, 201)
  } catch (e) {
    console.error('[payments] create failed:', e instanceof Error ? e.message : e)
    return json({ error: 'Could not save your request' }, 500)
  }
}
