/**
 * Guards for the admin settings and mission-editor routes. Editors are Dread Pizza Roberts only,
 * pinned to the role id in code (isDreadPizzaRoberts): the gate never reads a setting, so no edit
 * can lock everyone out or hand the editor to someone else. Fails closed.
 *
 * Writes are CSRF-safe the same way the other admin routes are (SameSite session cookie), plus an
 * explicit check here: the body must be JSON (a cross-site form cannot send that without a
 * preflight) and a browser Origin, when present, must be this host.
 */
import { NextResponse } from 'next/server'
import { requireSession, type GuardResult } from '@/app/lib/auth-guards'
import { isDreadPizzaRoberts } from '@/app/lib/mission-review-access'
import { NO_STORE_HEADERS } from '@/app/lib/no-store'

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS })
}

/** 401 without a session, 403 unless Dread Pizza Roberts. */
export async function requireDpr(): Promise<GuardResult> {
  const auth = await requireSession()
  if (!auth.ok) return { ok: false, response: json({ error: 'Not authenticated' }, 401) }
  if (!(await isDreadPizzaRoberts(auth.session.discordId))) {
    return { ok: false, response: json({ error: 'Forbidden' }, 403) }
  }
  return auth
}

/** Null when the write request looks same-origin and JSON; otherwise the rejection response. */
export function rejectUnsafeWrite(request: Request): NextResponse | null {
  const type = request.headers.get('content-type') ?? ''
  if (!type.toLowerCase().startsWith('application/json')) return json({ error: 'Content-Type must be application/json' }, 415)
  const origin = request.headers.get('origin')
  if (origin) {
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
    let originHost = ''
    try {
      originHost = new URL(origin).host
    } catch {
      /* malformed: rejected below */
    }
    if (!host || originHost !== host) return json({ error: 'Cross-origin request rejected' }, 403)
  }
  return null
}

/** True on any deploy that is not production (previews share the production database). */
export function isNonProductionDeploy(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VERCEL_ENV !== 'production'
}
