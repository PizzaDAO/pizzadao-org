import { NextResponse } from 'next/server'
import { requireCallReviewer } from '@/app/lib/calls/access'
import { fetchAllMembers } from '@/app/lib/sheets/members-list'
import { withErrorHandling } from '@/app/lib/errors/error-response'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/**
 * GET /api/admin/calls/members?q=ann — find a PizzaDAO member to link to a diarized speaker. Dread Pizza
 * Roberts only (the Discord id is returned so the speaker can be linked). At most 8 matches, 2+ characters.
 */
export const GET = withErrorHandling(async (request: Request) => {
  const auth = await requireCallReviewer()
  if (!auth.ok) return auth.response

  const q = fold(new URL(request.url).searchParams.get('q') ?? '')
  if (q.length < 2) return NextResponse.json({ members: [] })
  const members = await fetchAllMembers({ includeDiscordId: true, includeUnonboarded: true })
  const matches = members
    .filter((m) => m.discordId && fold(m.name).includes(q))
    .sort((a, b) => Number(fold(b.name).startsWith(q)) - Number(fold(a.name).startsWith(q)) || a.name.localeCompare(b.name))
    .slice(0, 8)
    .map((m) => ({ discordId: m.discordId, name: m.name }))
  return NextResponse.json({ members: matches })
})
