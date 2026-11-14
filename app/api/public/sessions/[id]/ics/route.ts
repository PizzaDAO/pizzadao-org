// GET /api/public/sessions/<id>/ics
//
// "Add to calendar" for one public session. 404 (same for every cause) while the public listing is
// off, or when the session is unknown, canceled or hidden.
import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { NotFoundError } from '@/app/lib/errors/api-errors'
import { SITE_HOST, SITE_URL } from '@/app/lib/site-url'
import { toggleEnabled } from '@/app/lib/settings/toggles'
import { buildIcs } from '@/app/lib/education-sessions/ics'
import { getPublicSession } from '@/app/lib/education-sessions/public'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

const GET_HANDLER = async (_request: NextRequest, { params }: Ctx) => {
  const { id } = await params
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(id) || !(await toggleEnabled('education.publicListingEnabled').catch(() => false))) throw new NotFoundError('Not found')
  const s = await getPublicSession(id)
  if (!s) throw new NotFoundError('Not found')
  const body = buildIcs({ ...s, url: s.eventUrl ?? `${SITE_URL}/learn` }, { host: SITE_HOST })
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="session-${id}.ics"`,
      'Cache-Control': 'public, max-age=300, s-maxage=300',
    },
  })
}

export const GET = withErrorHandling(GET_HANDLER)
