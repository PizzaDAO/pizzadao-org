// app/api/memes/route.ts
//
// GET: the meme gallery for signed-in members (approved memes, or the caller's own with tab=mine),
// cursor-paged. With the feature off it answers { enabled: false } so the dashboard card can hide itself.
// ?meta=1 adds what the page and card need to decide what to show (upload allowed, reviewer, waiting count).
import { NextRequest } from 'next/server'
import { requireSession } from '@/app/lib/auth-guards'
import { json } from '@/app/lib/admin-guard'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { isMemeReviewer, memesEnabled, uploadEligibility } from '@/app/lib/memes/access'
import { MEME_TABS, listMemes, pendingCount, uploadLimitBytes, type MemeTab } from '@/app/lib/memes/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const GET_HANDLER = async (request: NextRequest) => {
  const auth = await requireSession()
  if (!auth.ok) return auth.response
  if (!(await memesEnabled())) return json({ enabled: false })

  const q = request.nextUrl.searchParams
  const tabParam = q.get('tab') ?? 'all'
  const tab: MemeTab = (MEME_TABS as readonly string[]).includes(tabParam) ? (tabParam as MemeTab) : 'all'
  const limit = Number(q.get('limit'))
  const discordId = auth.session.discordId

  const page = await listMemes({ tab, viewerId: discordId, cursor: q.get('cursor'), limit: Number.isFinite(limit) && limit > 0 ? limit : undefined })

  // meta=1: everything the page needs. meta=card: only what the dashboard card needs (no level lookup).
  let meta: Record<string, unknown> | undefined
  const wantMeta = q.get('meta')
  if (wantMeta === '1') {
    const [eligibility, reviewer] = await Promise.all([uploadEligibility(discordId), isMemeReviewer(discordId)])
    meta = {
      canUpload: eligibility.ok,
      uploadBlockedReason: eligibility.ok ? null : eligibility.reason,
      minLevel: eligibility.ok ? null : eligibility.minLevel,
      maxUploadBytes: await uploadLimitBytes(),
      reviewer,
      pending: reviewer ? await pendingCount() : null,
    }
  } else if (wantMeta === 'card') {
    const reviewer = await isMemeReviewer(discordId)
    meta = { reviewer, pending: reviewer ? await pendingCount() : null }
  }
  return json({ enabled: true, ...page, ...(meta ? { meta } : {}) })
}

export const GET = withErrorHandling(GET_HANDLER)
