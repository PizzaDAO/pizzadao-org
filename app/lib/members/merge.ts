/**
 * Member merge: fold a duplicate member (removeId) into the one to keep (keepId).
 *
 * Every column that holds a member id (the sheet "ID" cell, e.g. "123") is re-pointed from removeId
 * to keepId. Where a unique key would collide (both members vouched for the same person, same wallet,
 * same weekly email, ...) the better/earlier row is kept, the other is dropped, and each collision is
 * reported. The removed Member row becomes a tombstone (mergedInto = keepId, discordId cleared) that
 * every reader skips. PEP balances are summed through the ledger (ADMIN_REMOVE / ADMIN_GRANT rows with
 * a "MERGE" memo), never by editing a wallet. One transaction, one advisory lock, one audit row.
 *
 * Rows keyed by a Discord id (not a member id) are not touched: if only removeId has a Discord id it
 * moves to keepId, so those rows follow it; if both have one, only the PEP balance is merged and the
 * report says the other Discord-keyed rows stay under the removed account's Discord id.
 *
 * Server-side only. app/lib/members/merge.test.ts keeps TABLES in step with prisma/schema.prisma.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

// The member-table write lock (writer.ts) and the signup lock (member-registration.ts): holding both keeps
// member writes and new signups out while ids move.
const LOCKS = [742019331, 742019332]

/** Plain relabel: no unique key involves the member id column. */
interface RelabelSpec { kind: 'relabel'; model: string; field: string }
/** Unique on (field, ...scope): a duplicate keeps one row, preferring the earlier `earliest` timestamp. */
interface UniqueSpec { kind: 'unique'; model: string; field: string; scope: string[]; earliest?: string }
/** The member id is (part of) the primary key / a unique of its own: one row per member. */
interface SingletonSpec { kind: 'singleton'; model: string; field: string }
/** String[] column holding member ids. */
interface ArraySpec { kind: 'array'; model: string; field: string }

export type TableSpec = RelabelSpec | UniqueSpec | SingletonSpec | ArraySpec

export const TABLES: TableSpec[] = [
  { kind: 'relabel', model: 'ProfileLink', field: 'memberId' },
  { kind: 'relabel', model: 'XAccount', field: 'memberId' },
  { kind: 'relabel', model: 'MissionCompletion', field: 'memberId' },
  { kind: 'relabel', model: 'Referral', field: 'inviteeMemberId' },
  { kind: 'relabel', model: 'Referral', field: 'inviterMemberId' },
  { kind: 'relabel', model: 'AttendanceNftClaim', field: 'memberId' },
  { kind: 'relabel', model: 'UnlockTicketClaim', field: 'memberId' },
  { kind: 'relabel', model: 'UnlockKey', field: 'memberId' },
  { kind: 'relabel', model: 'Suggestion', field: 'memberId' },
  { kind: 'relabel', model: 'RoleGrantEvent', field: 'memberId' },
  { kind: 'relabel', model: 'TelegramAccount', field: 'memberId' },
  { kind: 'relabel', model: 'TelegramHostMatch', field: 'memberId' },
  { kind: 'relabel', model: 'SupportTicket', field: 'memberId' },
  { kind: 'relabel', model: 'SpotlightSubmission', field: 'submitterMemberId' },
  { kind: 'relabel', model: 'SpotlightSubmission', field: 'nomineeMemberId' },
  { kind: 'relabel', model: 'ActivationEvent', field: 'memberKey' },
  { kind: 'relabel', model: 'PizzeriaCheckIn', field: 'memberId' },
  { kind: 'relabel', model: 'PassportStamp', field: 'memberId' },
  { kind: 'relabel', model: 'FollowUp', field: 'ownerMemberId' },
  { kind: 'relabel', model: 'PaymentRequest', field: 'requesterMemberId' },
  { kind: 'relabel', model: 'PfpRestyle', field: 'memberId' },
  { kind: 'relabel', model: 'EmailConfirmSend', field: 'memberId' },
  { kind: 'relabel', model: 'CrewTaskProposal', field: 'leadMemberId' },
  { kind: 'relabel', model: 'CrewTask', field: 'leadMemberId' },
  { kind: 'relabel', model: 'CrewRole', field: 'memberId' },
  { kind: 'unique', model: 'SocialAccount', field: 'memberId', scope: ['platform'] },
  { kind: 'unique', model: 'MemberWallet', field: 'memberId', scope: ['walletAddress'] },
  { kind: 'unique', model: 'TaskClaimEvent', field: 'memberId', scope: ['taskKey'], earliest: 'claimedAt' },
  { kind: 'unique', model: 'PoapFirstSeen', field: 'memberId', scope: ['poapEventId'], earliest: 'firstSeenAt' },
  { kind: 'unique', model: 'ReengageEmailSend', field: 'memberId', scope: ['weekKey'] },
  { kind: 'singleton', model: 'AttendanceSummary', field: 'memberId' },
  { kind: 'singleton', model: 'UnlockScanState', field: 'memberId' },
  { kind: 'singleton', model: 'MemberProfileExtras', field: 'memberId' },
  { kind: 'singleton', model: 'MemberPfp', field: 'memberId' },
  { kind: 'singleton', model: 'MafiaRankCache', field: 'memberId' },
  { kind: 'singleton', model: 'TelegramHostMatchCheck', field: 'memberId' },
  { kind: 'array', model: 'Article', field: 'collaboratorMemberIds' },
  { kind: 'array', model: 'AccountSignal', field: 'memberIds' },
]

/** Vouch is handled by its own step (two member columns, self-vouches after the merge are dropped). */
export const VOUCH_MODEL = 'Vouch'

export interface TableReport {
  table: string
  column: string
  /** Rows re-pointed to keepId. */
  moved: number
  /** Rows dropped because keepId already had the equivalent row. */
  dropped: number
  collisions: string[]
}

export interface MergeReport {
  keepId: string
  removeId: string
  dryRun: boolean
  tables: TableReport[]
  discord: { action: 'none' | 'moved' | 'cleared-same' | 'both-kept'; keepDiscordId: string | null; removeDiscordId: string | null }
  pep: { moved: number; fromDiscordId: string | null; toDiscordId: string | null } | null
  notes: string[]
  totals: { moved: number; dropped: number; collisions: number }
}

export interface MergeOptions {
  keepId: string
  removeId: string
  /** Defaults to true: nothing is written. */
  dryRun?: boolean
  actor?: string
}

export interface MergeDeps {
  prisma?: any
  invalidate?: () => void | Promise<void>
}

export class MergeError extends Error {}

const delegateName = (model: string) => model.charAt(0).toLowerCase() + model.slice(1)

function sameTime(a: unknown, b: unknown): number {
  const x = a instanceof Date ? a.getTime() : new Date(a as any).getTime()
  const y = b instanceof Date ? b.getTime() : new Date(b as any).getTime()
  return x - y
}

type Ctx = { db: any; write: boolean; keepId: string; removeId: string }

async function relabel(ctx: Ctx, s: RelabelSpec): Promise<TableReport> {
  const d = ctx.db[delegateName(s.model)]
  const where = { [s.field]: ctx.removeId }
  const moved = await d.count({ where })
  if (ctx.write && moved > 0) await d.updateMany({ where, data: { [s.field]: ctx.keepId } })
  return { table: s.model, column: s.field, moved, dropped: 0, collisions: [] }
}

async function uniqueMerge(ctx: Ctx, s: UniqueSpec): Promise<TableReport> {
  const d = ctx.db[delegateName(s.model)]
  const rep: TableReport = { table: s.model, column: s.field, moved: 0, dropped: 0, collisions: [] }
  const removeRows: any[] = await d.findMany({ where: { [s.field]: ctx.removeId } })
  if (removeRows.length === 0) return rep
  const keepRows: any[] = await d.findMany({ where: { [s.field]: ctx.keepId } })
  const keyOf = (r: any) => s.scope.map((f) => String(r[f])).join('|')
  const keepByKey = new Map(keepRows.map((r) => [keyOf(r), r]))
  for (const r of removeRows) {
    const existing = keepByKey.get(keyOf(r))
    if (!existing) {
      rep.moved++
      if (ctx.write) await d.update({ where: { id: r.id }, data: { [s.field]: ctx.keepId } })
      continue
    }
    rep.dropped++
    let note = `${keyOf(r)}: kept ${ctx.keepId}'s row, dropped duplicate`
    if (s.earliest && r[s.earliest] && sameTime(r[s.earliest], existing[s.earliest]) < 0) {
      note += ` (took the earlier ${s.earliest})`
      if (ctx.write) await d.update({ where: { id: existing.id }, data: { [s.earliest]: r[s.earliest] } })
    }
    rep.collisions.push(note)
    if (ctx.write) await d.delete({ where: { id: r.id } })
  }
  return rep
}

async function singleton(ctx: Ctx, s: SingletonSpec): Promise<TableReport> {
  const d = ctx.db[delegateName(s.model)]
  const rep: TableReport = { table: s.model, column: s.field, moved: 0, dropped: 0, collisions: [] }
  const mine = await d.count({ where: { [s.field]: ctx.removeId } })
  if (mine === 0) return rep
  const kept = await d.count({ where: { [s.field]: ctx.keepId } })
  if (kept > 0) {
    rep.dropped = mine
    rep.collisions.push(`both members have a row: kept ${ctx.keepId}'s, dropped ${ctx.removeId}'s`)
    if (ctx.write) await d.deleteMany({ where: { [s.field]: ctx.removeId } })
  } else {
    rep.moved = mine
    if (ctx.write) await d.updateMany({ where: { [s.field]: ctx.removeId }, data: { [s.field]: ctx.keepId } })
  }
  return rep
}

async function arrayMerge(ctx: Ctx, s: ArraySpec): Promise<TableReport> {
  const d = ctx.db[delegateName(s.model)]
  const rep: TableReport = { table: s.model, column: s.field, moved: 0, dropped: 0, collisions: [] }
  const rows: any[] = await d.findMany({ where: { [s.field]: { has: ctx.removeId } } })
  for (const r of rows) {
    const list: string[] = r[s.field] ?? []
    const hadKeep = list.includes(ctx.keepId)
    const next = [...new Set(list.map((x) => (x === ctx.removeId ? ctx.keepId : x)))]
    rep.moved++
    if (hadKeep) rep.collisions.push(`row ${r.id ?? '?'}: already listed ${ctx.keepId}, merged to one entry`)
    if (ctx.write) await d.update({ where: { id: r.id }, data: { [s.field]: next } })
  }
  return rep
}

async function vouches(ctx: Ctx): Promise<TableReport[]> {
  const d = ctx.db[delegateName(VOUCH_MODEL)]
  const { keepId, removeId } = ctx
  const out: TableReport[] = []
  for (const [col, other] of [['followerId', 'followeeId'], ['followeeId', 'followerId']] as const) {
    const rep: TableReport = { table: VOUCH_MODEL, column: col, moved: 0, dropped: 0, collisions: [] }
    const rows: any[] = await d.findMany({ where: { [col]: removeId } })
    for (const r of rows) {
      const counterpart: string = r[other]
      if (counterpart === keepId) {
        rep.dropped++
        rep.collisions.push(`vouch between ${keepId} and ${removeId} would be a self-vouch: dropped`)
        if (ctx.write) await d.delete({ where: { id: r.id } })
        continue
      }
      const dup = await d.count({ where: { [col]: keepId, [other]: counterpart } })
      if (dup > 0) {
        rep.dropped++
        rep.collisions.push(`${col === 'followerId' ? `vouched for ${counterpart}` : `vouched for by ${counterpart}`}: ${keepId} already has it, dropped duplicate`)
        if (ctx.write) await d.delete({ where: { id: r.id } })
      } else {
        rep.moved++
        if (ctx.write) await d.update({ where: { id: r.id }, data: { [col]: keepId } })
      }
    }
    out.push(rep)
  }
  return out
}

function setDiscordCell(cells: unknown, headers: unknown, discordId: string): unknown {
  const hs = (Array.isArray(headers) ? headers : []).map((h) => String(h ?? '').trim().toLowerCase().replace(/[#\s\-_]+/g, ''))
  const idx = hs.findIndex((h) => h === 'discordid' || h === 'discord' || h === 'discorduser')
  if (idx < 0) return cells
  const arr = Array.isArray(cells) ? [...cells] : []
  while (arr.length <= idx) arr.push(null)
  arr[idx] = { v: discordId }
  return arr
}

/** Plan (dryRun) or perform the merge. Throws MergeError for bad input. */
export async function mergeMembers(opts: MergeOptions, deps: MergeDeps = {}): Promise<MergeReport> {
  const keepId = String(opts.keepId ?? '').trim()
  const removeId = String(opts.removeId ?? '').trim()
  const dryRun = opts.dryRun !== false
  const actor = opts.actor ?? 'unknown'
  if (!keepId || !removeId) throw new MergeError('Both a member to keep and one to remove are required.')
  if (keepId === removeId) throw new MergeError('Cannot merge a member into themselves.')

  const prisma = deps.prisma ?? (await import('@/app/lib/db')).prisma

  const run = async (db: any, write: boolean): Promise<MergeReport> => {
    const [keep, remove] = await Promise.all([
      db.member.findUnique({ where: { id: keepId } }),
      db.member.findUnique({ where: { id: removeId } }),
    ])
    if (!keep) throw new MergeError(`Member ${keepId} (to keep) was not found.`)
    if (!remove) throw new MergeError(`Member ${removeId} (to remove) was not found.`)
    if (keep.mergedInto) throw new MergeError(`Member ${keepId} was already merged into ${keep.mergedInto}.`)
    if (remove.mergedInto) throw new MergeError(`Member ${removeId} was already merged into ${remove.mergedInto}.`)

    const ctx: Ctx = { db, write, keepId, removeId }
    const tables: TableReport[] = []
    for (const s of TABLES) {
      if (s.kind === 'relabel') tables.push(await relabel(ctx, s))
      else if (s.kind === 'unique') tables.push(await uniqueMerge(ctx, s))
      else if (s.kind === 'singleton') tables.push(await singleton(ctx, s))
      else tables.push(await arrayMerge(ctx, s))
    }
    tables.push(...(await vouches(ctx)))

    // Discord id: keepId keeps its own; take removeId's only when keepId has none.
    const dK: string | null = keep.discordId || null
    const dR: string | null = remove.discordId || null
    const notes: string[] = []
    let discordAction: MergeReport['discord']['action'] = 'none'
    let pep: MergeReport['pep'] = null
    if (dR && !dK) {
      discordAction = 'moved'
      notes.push(`Discord id ${dR} moves from ${removeId} to ${keepId}; Discord-keyed rows (PEP, missions, ...) follow it.`)
    } else if (dR && dK && dR === dK) {
      discordAction = 'cleared-same'
    } else if (dR && dK) {
      discordAction = 'both-kept'
      notes.push(`Both members have a Discord id (${dK} kept, ${dR} removed). Only the PEP balance is merged; other Discord-keyed rows stay under ${dR}.`)
      const econ = await db.economy.findUnique({ where: { id: dR } })
      const wallet = Number(econ?.wallet ?? 0)
      if (wallet > 0) pep = { moved: wallet, fromDiscordId: dR, toDiscordId: dK }
    }

    if (write) {
      const now = new Date()
      if (pep && dR && dK) {
        const { creditInTx, debitInTx, lockWallet } = await import('@/app/lib/economy')
        for (const id of [dR, dK].sort()) {
          await db.user.upsert({ where: { id }, create: { id, roles: [] }, update: {} })
          await db.economy.upsert({ where: { id }, create: { id, wallet: 0 }, update: {} })
          await lockWallet(db, id)
        }
        const current = await db.economy.findUnique({ where: { id: dR } })
        const amount = Number(current?.wallet ?? 0)
        if (amount > 0) {
          const memo = `MERGE: member ${removeId} merged into ${keepId}`
          const metadata = { merge: true, keepId, removeId }
          await debitInTx(db, dR, amount, 'ADMIN_REMOVE', memo, metadata)
          await creditInTx(db, dK, amount, 'ADMIN_GRANT', memo, metadata)
          pep.moved = amount
        } else {
          pep = null
        }
      }

      const layout = discordAction === 'moved' ? await db.memberTableLayout.findUnique({ where: { id: 1 } }) : null
      if (discordAction === 'moved' && dR) {
        // Free the id on the tombstone first so the id is never held by two live rows.
        await db.member.update({ where: { id: removeId }, data: { discordId: null } })
        await db.member.update({
          where: { id: keepId },
          data: { discordId: dR, cells: setDiscordCell(keep.cells, layout?.headers, dR) as any, updatedBy: `member-merge:${actor}` },
        })
      } else if (dR) {
        await db.member.update({ where: { id: removeId }, data: { discordId: null } })
      }
      await db.member.update({
        where: { id: removeId },
        data: { mergedInto: keepId, mergedAt: now, updatedBy: `member-merge:${actor}` },
      })
    }

    const totals = {
      moved: tables.reduce((n, t) => n + t.moved, 0),
      dropped: tables.reduce((n, t) => n + t.dropped, 0),
      collisions: tables.reduce((n, t) => n + t.collisions.length, 0),
    }
    const report: MergeReport = {
      keepId, removeId, dryRun: !write, tables,
      discord: { action: discordAction, keepDiscordId: dK, removeDiscordId: dR },
      pep, notes, totals,
    }
    if (write) {
      await db.memberMerge.create({ data: { keepId, removeId, actor, report: report as any } })
    }
    return report
  }

  if (dryRun) return run(prisma, false)

  const report = await prisma.$transaction(
    async (tx: any) => {
      for (const k of LOCKS) await tx.$executeRaw`SELECT pg_advisory_xact_lock(${k})`
      return run(tx, true)
    },
    { timeout: 120_000, maxWait: 15_000 },
  )

  try {
    if (deps.invalidate) await deps.invalidate()
    else (await import('@/app/lib/sheets/member-repository')).invalidateMembersCache()
  } catch {
    // Outside a Next request (the CLI) there is no cache to expire; the memo ages out on its own.
  }
  return report
}
