import { NextResponse } from 'next/server'
import { requireSession } from '@/app/lib/auth-guards'
import { internalError } from '@/app/lib/errors/error-response'
import { claimCrewTask } from '@/app/lib/crews/claim-task'

// The claim / give-up rules live in app/lib/crews/claim-task.ts, shared with the Discord /task command.
export async function POST(req: Request) {
  const auth = await requireSession()
  if (!auth.ok) return auth.response

  try {
    // memberId in the body is ignored: it is always derived from the session.
    const { sheetUrl, taskName, action = 'claim', crewId } = await req.json()

    if (action !== 'claim' && action !== 'giveup') {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    const result = await claimCrewTask({
      discordId: auth.session.discordId,
      action,
      crewId: typeof crewId === 'string' ? crewId : null,
      sheetUrl: typeof sheetUrl === 'string' ? sheetUrl : null,
      taskName: typeof taskName === 'string' ? taskName : null,
      requireOpen: true,
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ success: true, action: result.action })
  } catch (e: unknown) {
    return internalError(e, 'claim-task', 'Failed to claim task')
  }
}
