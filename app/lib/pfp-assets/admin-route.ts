// Wrapper for /api/admin/pfp-assets/*: Dread Pizza Roberts only (same pinned gate as the mission
// editor), CSRF checks on writes, errors mapped to status codes, responses never cached.
import { json, rejectCrossOrigin, rejectUnsafeWrite, requireDpr } from '@/app/lib/admin-guard'
import { handleApiError } from '@/app/lib/errors/error-response'
import { ValidationError } from '@/app/lib/errors/api-errors'
import { NO_STORE_HEADERS } from '@/app/lib/no-store'
import type { Session } from '@/app/lib/session'

export type AdminCtx = { params: Promise<Record<string, string>> }

export function pfpAdminRoute(
  handler: (req: Request, session: Session, ctx: AdminCtx) => Promise<unknown>,
  opts: { multipart?: boolean } = {},
) {
  return async (req: Request, ctx: AdminCtx = { params: Promise.resolve({}) }) => {
    const auth = await requireDpr()
    if (!auth.ok) return auth.response
    if (req.method !== 'GET') {
      const bad = opts.multipart ? rejectCrossOrigin(req) : rejectUnsafeWrite(req)
      if (bad) return bad
    }
    try {
      return json(await handler(req, auth.session, ctx))
    } catch (e) {
      const res = handleApiError(e)
      for (const [k, v] of Object.entries(NO_STORE_HEADERS)) res.headers.set(k, v)
      return res
    }
  }
}

/** Parse a JSON object body (max ~16 KB), or throw a 400. */
export async function jsonBody(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text()
  if (text.length > 16_384) throw new ValidationError('Request too large')
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw new ValidationError('Invalid JSON')
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError('Invalid request')
  return body as Record<string, unknown>
}
