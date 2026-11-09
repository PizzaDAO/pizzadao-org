import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { rejectUnsafeWrite } from '@/app/lib/admin-guard'
import { checkKeyedRateLimit, enforceRateLimit } from '@/app/lib/rate-limit'
import { NO_STORE_HEADERS } from '@/app/lib/no-store'
import { collectIncome, incomeStatus } from '@/app/lib/pep-earn/income'
import { loadIncomeContext } from '@/app/lib/pep-earn/income-web'

export const runtime = 'nodejs'

const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE_HEADERS })

/** GET: what the signed-in member can collect right now (same cooldowns as /collect-income). */
export async function GET() {
  const session = await getSession()
  if (!session?.discordId) return reply({ error: 'Not authenticated' }, 401)
  const ctx = await loadIncomeContext(session.discordId)
  if (!ctx.ok) return reply({ error: 'roles_unavailable' }, 503)
  const s = await incomeStatus(session.discordId, ctx.roleIds, ctx.incomes)
  return reply({
    available: s.available,
    waiting: s.waiting.map((w) => ({ ...w, readyAt: w.readyAt.toISOString() })),
    totalAvailable: s.totalAvailable,
    nextReadyAt: s.nextReadyAt?.toISOString() ?? null,
    earnRoles: ctx.earnRoles,
  })
}

/**
 * POST: collect. Runs the exact collectIncome the slash command runs, so cooldowns and amounts are shared:
 * collecting here blocks /collect-income (and the reverse) until the next period.
 */
export async function POST(request: NextRequest) {
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  const limited = await enforceRateLimit(request, 'collect-income')
  if (limited) return limited
  const session = await getSession()
  if (!session?.discordId) return reply({ error: 'Not authenticated' }, 401)
  const memberLimit = await checkKeyedRateLimit('collect-income', session.discordId)
  if (!memberLimit.success) return reply({ error: 'rate_limited' }, 429)

  const ctx = await loadIncomeContext(session.discordId)
  if (!ctx.ok) return reply({ error: 'roles_unavailable' }, 503)

  const result = await collectIncome(session.discordId, ctx.roleIds, ctx.incomes)
  const interval = new Map(ctx.incomes.map((i) => [i.roleId, i.intervalHours]))
  const now = Date.now()
  const times = [
    ...result.waiting.map((w) => w.readyAt.getTime()),
    ...result.paid.map((p) => now + (interval.get(p.roleId) ?? 24) * 3_600_000),
  ]
  return reply({
    paid: result.paid,
    waiting: result.waiting.map((w) => ({ ...w, readyAt: w.readyAt.toISOString() })),
    total: result.total,
    balance: result.balance,
    nextReadyAt: times.length ? new Date(Math.min(...times)).toISOString() : null,
  })
}
