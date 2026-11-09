/**
 * Every members write goes through here (plans/sheets-cutover.md PR 7).
 *
 * - `sheets.source.members` = sheet (default): POST to the Apps Script web app, as before.
 * - = db: apply the same rules to the Member table (app/lib/members/upsert.ts) under a database
 *   lock, then, while `sheets.mirror.members` is on, also send the same payload to the web app so
 *   the old sheet stays current until the freeze (best effort: a failed copy is logged, the
 *   database write stands).
 *
 * The result is shaped like the web app's reply ({ status, text } with { ok, crewSync }), so the
 * callers' response handling does not change.
 */
import { fetchWithRedirect } from '@/app/lib/sheet-utils'
import { memberIndexFields, planMemberUpsert, type MemberCells, type MemberWriteRaw, type UpsertResult } from './upsert'

async function membersFromDb(): Promise<boolean> {
  const { usesDb } = await import('@/app/lib/sheets-import/source')
  return usesDb('members')
}

/** Serializes database member writes (and keeps them apart from id allocation, which uses ...331). */
const MEMBER_WRITE_LOCK = 742019332

/** Whether a members write can be sent at all (the web app env vars are only needed in sheet mode). */
export async function memberWritesConfigured(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (await membersFromDb()) return true
  return !!(env.GOOGLE_SHEETS_WEBAPP_URL && env.GOOGLE_SHEETS_SHARED_SECRET)
}

/** Apply one write to the Member table. Same rules and answers as the web app's upsert. */
export async function upsertMemberInDb(raw: MemberWriteRaw, actor: string, now: Date = new Date()): Promise<UpsertResult> {
  const { prisma } = await import('@/app/lib/db')
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${MEMBER_WRITE_LOCK})`
      const layout = await tx.memberTableLayout.findUnique({ where: { id: 1 } })
      if (!layout) return { ok: false, error: 'Members table is not imported yet.' } as UpsertResult
      const headers = (Array.isArray(layout.headers) ? layout.headers : []).map((h) => String(h ?? ''))
      const members = (await tx.member.findMany({ where: { mergedInto: null }, select: { id: true, cells: true } })).map((m) => ({ id: m.id, cells: (Array.isArray(m.cells) ? m.cells : []) as MemberCells }))
      const plan = planMemberUpsert(headers, members, raw, now.toISOString())
      if (!plan.ok || plan.skipped) return plan
      const { discordId, name } = memberIndexFields(headers, plan.cells)
      const data = { cells: plan.cells as never, discordId, name, updatedBy: actor }
      if (plan.action === 'inserted') {
        const last = await tx.member.aggregate({ _max: { position: true } })
        await tx.member.create({ data: { id: plan.targetId, position: (last._max.position ?? 0) + 1, ...data } })
      } else {
        if (plan.previousId && plan.targetId !== plan.previousId && members.some((m) => m.id === plan.targetId)) {
          return { ok: false, error: `Member ID ${plan.targetId} is already used by another row.` } as UpsertResult
        }
        await tx.member.update({ where: { id: plan.previousId! }, data: { id: plan.targetId, ...data } })
      }
      return plan
    },
    { timeout: 20000, maxWait: 10000 },
  )
}

/**
 * Send a members write. `payload` is what the callers have always posted to the web app
 * ({ secret, source, memberId, ..., raw? }); like the web app, `raw` wins when present.
 */
export async function postMemberWrite(payload: Record<string, unknown>, env: NodeJS.ProcessEnv = process.env): Promise<{ status: number; text: string }> {
  const url = env.GOOGLE_SHEETS_WEBAPP_URL
  if (!(await membersFromDb())) {
    if (!url) throw new Error('Missing Sheets webapp env vars')
    return fetchWithRedirect(url, payload)
  }

  const raw = (payload.raw && typeof payload.raw === 'object' ? payload.raw : payload) as MemberWriteRaw
  let result: UpsertResult
  try {
    result = await upsertMemberInDb(raw, `member-write:${String(raw.source ?? 'web').slice(0, 30)}`)
  } catch (e) {
    console.error('[members] database write failed', e instanceof Error ? e.message : e)
    return { status: 500, text: JSON.stringify({ ok: false, error: 'Database write failed' }) }
  }

  if (result.ok && !result.skipped && url) {
    const { membersMirrorEnabled } = await import('@/app/lib/sheets-import/source')
    if (await membersMirrorEnabled(env)) {
      try {
        const copy = await fetchWithRedirect(url, payload)
        if (copy.status < 200 || copy.status >= 300) console.error('[members] sheet copy failed', copy.status)
      } catch (e) {
        console.error('[members] sheet copy failed', e instanceof Error ? e.message : e)
      }
    }
  }

  const crewSync = result.ok && !result.skipped ? { ok: true, action: result.action, sheet: 'db', id: result.id } : result
  return { status: 200, text: JSON.stringify({ ok: result.ok, crewSync }) }
}
