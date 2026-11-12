// GET /api/crew/education/sessions/flyer?title=&presenter=&date=&time=&timeZone=
//
// The flyer PNG for the form's live preview. Same auth as scheduling; never posts anything and
// works whether or not the announce switch is on. The date may be in the past here (it is only a picture).
import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { ValidationError } from '@/app/lib/errors/api-errors'
import { requireEducationManager } from '@/app/lib/education-sessions/access'
import { parseSessionInput, SessionInputError } from '@/app/lib/education-sessions/build'
import { flyerResponse } from '@/app/lib/education-sessions/flyer'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ crewId: string }> }

const GET_HANDLER = async (request: NextRequest, { params }: Ctx) => {
  const { crewId } = await params
  await requireEducationManager(crewId)
  const q = request.nextUrl.searchParams
  let s
  try {
    s = parseSessionInput(
      {
        title: q.get('title'),
        presenter: q.get('presenter'),
        description: 'preview',
        date: q.get('date'),
        time: q.get('time'),
        timeZone: q.get('timeZone'),
        lengthMinutes: 60,
      },
      new Date(0),
    )
  } catch (e) {
    if (e instanceof SessionInputError) throw new ValidationError(e.message)
    throw e
  }
  const png = await flyerResponse(s).arrayBuffer()
  return new NextResponse(png, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store' } })
}

export const GET = withErrorHandling(GET_HANDLER)
