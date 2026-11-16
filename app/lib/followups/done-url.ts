/**
 * The link to the finished work a member (or a reviewer) attaches to a follow-up. It is shown
 * publicly next to the action item, so it must be a plain http(s) URL (safeEvidenceUrl: no
 * javascript:/data:, no spaces or characters that break a masked link, at most 500 characters)
 * and must pass the call post filter. Unreadable filter: rejected (fail-safe).
 */
import { safeEvidenceUrl } from '@/app/lib/calls/evidence'
import { loadPostFilter, mentionsBlockedTerm } from '@/app/lib/calls/post-filters'

export async function checkDoneUrl(raw: unknown): Promise<string | null> {
  const url = safeEvidenceUrl(raw)
  if (!url) return null
  try {
    return mentionsBlockedTerm(url, await loadPostFilter()) ? null : url
  } catch {
    return null
  }
}

/** Host of a checked URL, for the approver alert and the audit log (never the whole URL). */
export const doneUrlHost = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'link'
  }
}
