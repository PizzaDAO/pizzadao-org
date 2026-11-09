// POST /api/pfp/restyle { outfitId, base: {kind, url?} } -> { url, outfitRemaining, dailyRemaining }
// AI dress up. Members only, rate limited. The server re-checks the outfit is unlocked and applies
// the cost controls (settings pfp.restyle*). The result is a candidate base picture; the member
// keeps it by saving through /api/pfp/compose with base kind "restyle".
import { memberPfpRoute } from '@/app/lib/pfp-assets/member-route'
import { jsonBody } from '@/app/lib/pfp-assets/admin-route'
import { isBaseKind } from '@/app/lib/pfp-assets/compose'
import { restyleForMember } from '@/app/lib/pfp-assets/restyle'
import { ValidationError } from '@/app/lib/errors/api-errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 180

export const POST = memberPfpRoute(
  async (req, { memberId, discordId }) => {
    const body = await jsonBody(req)
    const outfitId = Number(body.outfitId)
    if (!Number.isInteger(outfitId) || outfitId < 1) throw new ValidationError('Pick an outfit', 'outfitId')
    const base = body.base as { kind?: unknown; url?: unknown } | undefined
    if (!base || !isBaseKind(base.kind)) throw new ValidationError('Choose a base picture', 'base')
    return restyleForMember({
      memberId,
      discordId,
      outfitId,
      base: { kind: base.kind, url: typeof base.url === 'string' ? base.url : undefined },
    })
  },
  { rateLimit: 'pfp-restyle' },
)
