// Wrapper for /api/admin/shop/* handlers: shop-admin guard first (401/403),
// ApiErrors become their status codes, responses are never cached.
import { NextResponse } from 'next/server'
import { requireShopAdmin } from './shop-admin-auth'
import { handleApiError } from './errors/error-response'
import { ValidationError } from './errors/api-errors'
import type { Session } from './session'

type Ctx = { params: Promise<Record<string, string>> }

export function shopAdminRoute(
  handler: (req: Request, session: Session, ctx: Ctx) => Promise<unknown>,
) {
  return async (req: Request, ctx: Ctx): Promise<NextResponse> => {
    const admin = await requireShopAdmin()
    if (!admin.ok) return admin.response
    try {
      const body = await handler(req, admin.session, ctx)
      return NextResponse.json(body, { headers: { 'Cache-Control': 'private, no-store' } })
    } catch (e) {
      return handleApiError(e)
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
