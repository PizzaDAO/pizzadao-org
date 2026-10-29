import { requireCallReviewer } from '@/app/lib/calls/access'
import { json } from '@/app/lib/admin-guard'
import { loadFollowUpConfig } from '@/app/lib/followups/config'
import { listFollowUps } from '@/app/lib/followups/admin'
import type { FollowUpStatus } from '@prisma/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STATUSES: FollowUpStatus[] = ['DRAFT', 'APPROVED', 'SENT', 'FAILED', 'UNREACHABLE', 'ESCALATED', 'REPLIED', 'IN_PROGRESS', 'NEEDS_HELP', 'DONE', 'DISMISSED']

/**
 * GET /api/admin/followups?status=DRAFT,APPROVED&recording=<id>
 * The approval queue with each row's audit timeline. Dread Pizza Roberts only (the call-review gate).
 */
export async function GET(request: Request) {
  const auth = await requireCallReviewer()
  if (!auth.ok) return auth.response
  const url = new URL(request.url)
  const status = (url.searchParams.get('status') ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s): s is FollowUpStatus => (STATUSES as string[]).includes(s))
  const recording = url.searchParams.get('recording')?.trim() || undefined
  const [list, cfg] = await Promise.all([listFollowUps({ status, recordingId: recording }), loadFollowUpConfig()])
  return json({ ...list, sendEnabled: cfg.sendEnabled, footerTelegram: cfg.footerTelegram, footerDiscord: cfg.footerDiscord })
}
