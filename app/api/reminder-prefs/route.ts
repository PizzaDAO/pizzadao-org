// app/api/reminder-prefs/route.ts
//
// The signed-in member's reminder settings (profile edit page).
//   GET  -> { calls: "NONE" | "COMMUNITY" | "MY_CREWS", dmClosed }
//   POST (application/json, same origin) { calls?, retryDm? } -> same
// Opt-in only: no row means no reminders. The member is the session's Discord id; nothing else is read.
import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/app/lib/auth-guards'
import { rejectUnsafeWrite } from '@/app/lib/admin-guard'
import { internalError } from '@/app/lib/errors/error-response'
import { loadPrefsView, prefsBody, savePrefs } from '@/app/lib/reminders/prefs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = await requireSession()
  if (!auth.ok) return auth.response
  try {
    return NextResponse.json(await loadPrefsView(auth.session.discordId))
  } catch (err) {
    return internalError(err, 'reminder-prefs GET', "Couldn't load reminder settings")
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireSession()
  if (!auth.ok) return auth.response
  const unsafe = rejectUnsafeWrite(req)
  if (unsafe) return unsafe
  const parsed = prefsBody.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid reminder settings' }, { status: 400 })
  try {
    return NextResponse.json(await savePrefs(auth.session.discordId, parsed.data))
  } catch (err) {
    return internalError(err, 'reminder-prefs POST', "Couldn't save reminder settings")
  }
}
