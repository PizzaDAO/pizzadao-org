/**
 * The link to the finished work a member (or a reviewer) attaches to a follow-up. It is shown
 * publicly next to the action item, so it must be a plain http(s) URL (safeEvidenceUrl: no
 * javascript:/data:, no spaces or characters that break a masked link, at most 500 characters)
 * and must pass the call post filter. Unreadable filter: rejected (fail-safe).
 */
import { safeEvidenceUrl } from '@/app/lib/calls/evidence'
import { loadPostFilter, mentionsBlockedTerm } from '@/app/lib/calls/post-filters'
import { toggleEnabled } from '@/app/lib/settings/toggles'

/**
 * Whether members may add a finished-work link at all: live status and member links are both on.
 * Off, the link buttons and fields are not offered and nothing is stored.
 */
export async function doneLinksOn(): Promise<boolean> {
  try {
    return (await toggleEnabled('calls.recapLiveStatusEnabled')) && (await toggleEnabled('calls.recapMemberLinksEnabled'))
  } catch {
    return false
  }
}

/** Whether a link is offered for this follow-up: the switches are on and it is tied to an action item (else it could never show). */
export async function linkOffered(row: { actionKey: string | null }): Promise<boolean> {
  return !!row.actionKey && (await doneLinksOn())
}

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
