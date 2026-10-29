/**
 * Mission.guideHref: the handbook page that explains how to do a mission (plans/onboarding-guide.md).
 * Internal paths only, so an admin edit can never produce an external or `javascript:` link.
 * Pure and client-safe (the admin editor and the server both use it).
 */
export const GUIDE_HREF_MAX = 120

/** Allowed shape: /handbook[/<slug>] or /calls/how-to-attend, with at most one #anchor. */
export const GUIDE_HREF_PATTERN = /^\/(handbook(\/[a-z0-9-]+)?|calls\/how-to-attend)(#[a-z0-9-]+)?$/

/** Trim; empty becomes null (no link); an invalid value returns the error text. */
export function parseGuideHref(raw: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined) return { ok: true, value: null }
  if (typeof raw !== 'string') return { ok: false, error: 'guideHref must be text' }
  const v = raw.trim()
  if (v === '') return { ok: true, value: null }
  if (v.length > GUIDE_HREF_MAX) return { ok: false, error: `guideHref must be at most ${GUIDE_HREF_MAX} characters` }
  if (!GUIDE_HREF_PATTERN.test(v)) {
    return { ok: false, error: 'guideHref must be a handbook path such as /handbook/levels#vouching (no external links)' }
  }
  return { ok: true, value: v }
}
