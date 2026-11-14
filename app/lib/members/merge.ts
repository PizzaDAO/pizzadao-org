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
 * Reversible: MemberMerge.report.undo holds the re-pointed row ids and snapshots of every dropped row;
 * unmergeMembers() restores them. Refuses unless members are read from the database.
 *
 * Server-side only. app/lib/members/merge.test.ts keeps TABLES in step with prisma/schema.prisma.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { headerColumn } from './upsert'

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
  { kind: 'relabel', model: 'NewsletterSubscriber', field: 'memberId' },
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
  { kind: 'singleton', model: 'MemberCollectionStats', field: 'memberId' },
  { kind: 'singleton', model: 'TelegramHostMatchCheck', field: 'memberId' },
  { kind: 'array', model: 'Article', field: 'collaboratorMemberIds' },
  { kind: 'array', model: 'AccountSignal', field: 'memberIds' },
]

/** Vouch is handled by its own step (two member columns, self-vouches after the merge are dropped). */
export const VOUCH_MODEL = 'Vouch'


/** Primary-key column per model when it is not `id`. Kept honest by merge.test.ts against the schema. */
export const PK_OVERRIDES: Record<string, string> = {
  AttendanceSummary: 'discordId',
  TelegramHostMatch: 'discordId',
  UnlockScanState: 'memberId',
  MemberProfileExtras: 'memberId',
  MemberPfp: 'memberId',
  MafiaRankCache: 'memberId',
  MemberCollectionStats: 'memberId',
  TelegramHostMatchCheck: 'memberId',
}
const pkOf = (model: string) => PK_OVERRIDES[model] ?? 'id'

export interface TableReport {
  table: string
  column: string
  /** Rows re-pointed to keepId. */
  moved: number
  /** Rows dropped because keepId already had the equivalent row. */
  dropped: number
  collisions: string[]
}

/** Everything unmergeMembers needs to put the data back. Stored in MemberMerge.report.undo. */
export interface UndoData {
  /** Rows re-pointed: pk values AFTER the move (for a pk that is the member id, that is keepId). */
  moved: Array<{ model: string; field: string; pk: string; ids: unknown[] }>
  /** Full JSON snapshots of rows that were dropped. */
  deleted: Array<{ model: string; pk: string; rows: Record<string, unknown>[] }>
  /** Keeper rows whose timestamp was lowered to the dropped row's earlier one. */
  adjusted: Array<{ model: string; pk: string; id: unknown; field: string; before: unknown }>
  /** Array columns as they were before. */
  arrays: Array<{ model: string; id: unknown; field: string; before: unknown[] }>
  keepBefore: { discordId: string | null; cells: unknown; updatedBy: string | null } | null
  removeBefore: { discordId: string | null; cells: unknown; updatedBy: string | null } | null
  pep: { amount: number; fromDiscordId: string; toDiscordId: string } | null
}

export interface MergeReport {
  keepId: string
  removeId: string
  dryRun: boolean
  /** Id of the MemberMerge audit row (apply only). */
  mergeId?: number
  tables: TableReport[]
  discord: { action: 'none' | 'moved' | 'cleared-same' | 'both-kept'; keepDiscordId: string | null; removeDiscordId: string | null }
  pep: { moved: number; fromDiscordId: string | null; toDiscordId: string | null } | null
  notes: string[]
  totals: { moved: number; dropped: number; collisions: number }
  /** Apply only. Stripped from API responses. */
  undo?: UndoData
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
  /** Whether members are read from the database (default: sheets source setting). */
  usesDb?: () => Promise<boolean>
}

export class MergeError extends Error {}

const delegateName = (model: string) => model.charAt(0).toLowerCase() + model.slice(1)

function timeDiff(a: unknown, b: unknown): number {
  const x = a instanceof Date ? a.getTime() : new Date(a as any).getTime()
  const y = b instanceof Date ? b.getTime() : new Date(b as any).getTime()
  return x - y
}

/** JSON-safe deep copy (Dates become ISO strings, which Prisma accepts back). */
const snap = <T>(v: T): T => JSON.parse(JSON.stringify(v))

type Ctx = { db: any; write: boolean; keepId: string; removeId: string; undo: UndoData }

async function relabel(ctx: Ctx, s: RelabelSpec): Promise<TableReport> {
  const d = ctx.db[delegateName(s.model)]
  const pk = pkOf(s.model)
  const rows: any[] = await d.findMany({ where: { [s.field]: ctx.removeId }, select: { [pk]: true } })
  const rep: TableReport = { table: s.model, column: s.field, moved: rows.length, dropped: 0, collisions: [] }
  if (ctx.write && rows.length > 0) {
    const ids = rows.map((r) => r[pk])
    await d.updateMany({ where: { [pk]: { in: ids }, [s.field]: ctx.removeId }, data: { [s.field]: ctx.keepId } })
    ctx.undo.moved.push({ model: s.model, field: s.field, pk, ids: pk === s.field ? ids.map(() => ctx.keepId) : ids })
  }
  return rep
}

async function uniqueMerge(ctx: Ctx, s: UniqueSpec): Promise<TableReport> {
  const d = ctx.db[delegateName(s.model)]
  const pk = pkOf(s.model)
  const rep: TableReport = { table: s.model, column: s.field, moved: 0, dropped: 0, collisions: [] }
  const removeRows: any[] = await d.findMany({ where: { [s.field]: ctx.removeId } })
  if (removeRows.length === 0) return rep
  const keepRows: any[] = await d.findMany({ where: { [s.field]: ctx.keepId } })
  const keyOf = (r: any) => s.scope.map((f) => String(r[f])).join('|')
  const keepByKey = new Map(keepRows.map((r) => [keyOf(r), r]))
  const movedIds: unknown[] = []
  const dropped: Record<string, unknown>[] = []
  for (const r of removeRows) {
    const existing = keepByKey.get(keyOf(r))
    if (!existing) {
      rep.moved++
      movedIds.push(r[pk])
      if (ctx.write) await d.update({ where: { [pk]: r[pk] }, data: { [s.field]: ctx.keepId } })
      continue
    }
    rep.dropped++
    let note = `${keyOf(r)}: kept ${ctx.keepId}'s row, dropped duplicate`
    if (s.earliest && r[s.earliest] && timeDiff(r[s.earliest], existing[s.earliest]) < 0) {
      note += ` (took the earlier ${s.earliest})`
      if (ctx.write) {
        ctx.undo.adjusted.push({ model: s.model, pk, id: existing[pk], field: s.earliest, before: snap(existing[s.earliest]) })
        await d.update({ where: { [pk]: existing[pk] }, data: { [s.earliest]: r[s.earliest] } })
      }
    }
    rep.collisions.push(note)
    if (ctx.write) {
      dropped.push(snap(r))
      await d.delete({ where: { [pk]: r[pk] } })
    }
  }
  if (ctx.write) {
    if (movedIds.length) ctx.undo.moved.push({ model: s.model, field: s.field, pk, ids: movedIds })
    if (dropped.length) ctx.undo.deleted.push({ model: s.model, pk, rows: dropped })
  }
  return rep
}

async function singleton(ctx: Ctx, s: SingletonSpec): Promise<TableReport> {
  const d = ctx.db[delegateName(s.model)]
  const pk = pkOf(s.model)
  const rep: TableReport = { table: s.model, column: s.field, moved: 0, dropped: 0, collisions: [] }
  const mine: any[] = await d.findMany({ where: { [s.field]: ctx.removeId } })
  if (mine.length === 0) return rep
  const kept = await d.count({ where: { [s.field]: ctx.keepId } })
  if (kept > 0) {
    rep.dropped = mine.length
    rep.collisions.push(`both members have a row: kept ${ctx.keepId}'s, dropped ${ctx.removeId}'s`)
    if (ctx.write) {
      ctx.undo.deleted.push({ model: s.model, pk, rows: snap(mine) })
      await d.deleteMany({ where: { [s.field]: ctx.removeId } })
    }
  } else {
    rep.moved = mine.length
    if (ctx.write) {
      await d.updateMany({ where: { [s.field]: ctx.removeId }, data: { [s.field]: ctx.keepId } })
      ctx.undo.moved.push({ model: s.model, field: s.field, pk, ids: mine.map((r) => (pk === s.field ? ctx.keepId : r[pk])) })
    }
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
    if (ctx.write) {
      ctx.undo.arrays.push({ model: s.model, id: r.id, field: s.field, before: [...list] })
      await d.update({ where: { id: r.id }, data: { [s.field]: next } })
    }
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
    const movedIds: unknown[] = []
    const dropped: Record<string, unknown>[] = []
    for (const r of rows) {
      const counterpart: string = r[other]
      if (counterpart === keepId) {
        rep.dropped++
        rep.collisions.push(`vouch between ${keepId} and ${removeId} would be a self-vouch: dropped`)
        if (ctx.write) { dropped.push(snap(r)); await d.delete({ where: { id: r.id } }) }
        continue
      }
      const dup = await d.count({ where: { [col]: keepId, [other]: counterpart } })
      if (dup > 0) {
        rep.dropped++
        rep.collisions.push(`${col === 'followerId' ? `vouched for ${counterpart}` : `vouched for by ${counterpart}`}: ${keepId} already has it, dropped duplicate`)
        if (ctx.write) { dropped.push(snap(r)); await d.delete({ where: { id: r.id } }) }
      } else {
        rep.moved++
        movedIds.push(r.id)
        if (ctx.write) await d.update({ where: { id: r.id }, data: { [col]: keepId } })
      }
    }
    if (ctx.write) {
      if (movedIds.length) ctx.undo.moved.push({ model: VOUCH_MODEL, field: col, pk: 'id', ids: movedIds })
      if (dropped.length) ctx.undo.deleted.push({ model: VOUCH_MODEL, pk: 'id', rows: dropped })
    }
    out.push(rep)
  }
  return out
}

/** Sets (or blanks, with '') the Discord cell of a sheet row. */
function setDiscordCell(cells: unknown, headers: unknown, discordId: string): unknown {
  const hs = (Array.isArray(headers) ? headers : []).map((h) => String(h ?? ''))
  const idx = headerColumn(hs, 'DiscordId')
  if (idx == null) return cells
  const arr = Array.isArray(cells) ? [...cells] : []
  while (arr.length <= idx) arr.push(null)
  arr[idx] = discordId ? { v: discordId } : null
  return arr
}

async function runTables(ctx: Ctx): Promise<TableReport[]> {
  const tables: TableReport[] = []
  for (const s of TABLES) {
    if (s.kind === 'relabel') tables.push(await relabel(ctx, s))
    else if (s.kind === 'unique') tables.push(await uniqueMerge(ctx, s))
    else if (s.kind === 'singleton') tables.push(await singleton(ctx, s))
    else tables.push(await arrayMerge(ctx, s))
  }
  tables.push(...(await vouches(ctx)))
  return tables
}

const emptyUndo = (): UndoData => ({ moved: [], deleted: [], adjusted: [], arrays: [], keepBefore: null, removeBefore: null, pep: null })

async function requireDb(deps: MergeDeps): Promise<void> {
  const fromDb = deps.usesDb ? await deps.usesDb() : await (await import('@/app/lib/sheets-import/source')).usesDb('members')
  if (!fromDb) throw new MergeError('Members are not read from the database here, so a merge would only change part of the data. Refusing.')
}

async function lockAll(tx: any) {
  for (const k of LOCKS) await tx.$executeRaw`SELECT pg_advisory_xact_lock(${k})`
}

async function expireCache(deps: MergeDeps) {
  try {
    if (deps.invalidate) await deps.invalidate()
    else (await import('@/app/lib/sheets/member-repository')).invalidateMembersCache()
  } catch {
    // Outside a Next request (the CLI) there is no cache to expire; the memo ages out on its own.
  }
}

/** Plan (dryRun) or perform the merge. Throws MergeError for bad input. */
export async function mergeMembers(opts: MergeOptions, deps: MergeDeps = {}): Promise<MergeReport> {
  const keepId = String(opts.keepId ?? '').trim()
  const removeId = String(opts.removeId ?? '').trim()
  const dryRun = opts.dryRun !== false
  const actor = opts.actor ?? 'unknown'
  if (!keepId || !removeId) throw new MergeError('Both a member to keep and one to remove are required.')
  if (keepId === removeId) throw new MergeError('Cannot merge a member into themselves.')
  await requireDb(deps)

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

    const undo = emptyUndo()
    const ctx: Ctx = { db, write, keepId, removeId, undo }
    const tables = await runTables(ctx)
    if (write) {
      // Second pass inside the same transaction: catches rows other requests inserted for removeId meanwhile.
      const again = await runTables(ctx)
      again.forEach((t, i) => {
        tables[i].moved += t.moved
        tables[i].dropped += t.dropped
        tables[i].collisions.push(...t.collisions)
      })
    }

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
      notes.push(
        `Both members have a Discord id. ${keepId} keeps ${dK}; ${removeId}'s ${dR} stays on the hidden record. ` +
          `Only the PEP balance is merged: missions, attendance, roles and other rows keyed by Discord id stay under ${dR} and do NOT follow the merge.`,
      )
      const econ = await db.economy.findUnique({ where: { id: dR } })
      const wallet = Number(econ?.wallet ?? 0)
      if (wallet > 0) pep = { moved: wallet, fromDiscordId: dR, toDiscordId: dK }
    }
    notes.push(`The members sheet is not changed by a merge: if it still has a row for ${removeId}, remove it there by hand (sheet mirroring is not updated by merges).`)

    if (write) {
      const now = new Date()
      undo.keepBefore = snap({ discordId: keep.discordId ?? null, cells: keep.cells, updatedBy: keep.updatedBy ?? null })
      undo.removeBefore = snap({ discordId: remove.discordId ?? null, cells: remove.cells, updatedBy: remove.updatedBy ?? null })
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
          undo.pep = { amount, fromDiscordId: dR, toDiscordId: dK }
        } else {
          pep = null
        }
      }

      const layout = dR ? await db.memberTableLayout.findUnique({ where: { id: 1 } }) : null
      if (dR) {
        // The tombstone's Discord cell is blanked too, so id allocation and signup checks never see it.
        await db.member.update({
          where: { id: removeId },
          data: { discordId: null, cells: setDiscordCell(remove.cells, layout?.headers, '') as any },
        })
      }
      if (discordAction === 'moved' && dR) {
        await db.member.update({
          where: { id: keepId },
          data: { discordId: dR, cells: setDiscordCell(keep.cells, layout?.headers, dR) as any, updatedBy: `member-merge:${actor}` },
        })
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
      report.undo = undo
      const row = await db.memberMerge.create({ data: { keepId, removeId, actor, report: report as any } })
      report.mergeId = row.id
    }
    return report
  }

  if (dryRun) return run(prisma, false)

  const report: MergeReport = await prisma.$transaction(
    async (tx: any) => {
      await lockAll(tx)
      return run(tx, true)
    },
    { timeout: 120_000, maxWait: 15_000 },
  )
  await expireCache(deps)
  return report
}

export interface UnmergeReport {
  mergeId: number
  keepId: string
  removeId: string
  dryRun: boolean
  movedBack: number
  restoredRows: number
  conflicts: string[]
  pep: { amount: number; fromDiscordId: string; toDiscordId: string } | null
  notes: string[]
}

/** Undo one merge from its audit row. Rows created for keepId after the merge cannot be told apart and stay with keepId. */
export async function unmergeMembers(mergeId: number, opts: { dryRun?: boolean; actor?: string } = {}, deps: MergeDeps = {}): Promise<UnmergeReport> {
  const dryRun = opts.dryRun !== false
  const actor = opts.actor ?? 'unknown'
  await requireDb(deps)
  const prisma = deps.prisma ?? (await import('@/app/lib/db')).prisma

  const run = async (db: any, write: boolean): Promise<UnmergeReport> => {
    const merge = await db.memberMerge.findUnique({ where: { id: mergeId } })
    if (!merge) throw new MergeError(`Merge ${mergeId} was not found.`)
    if (merge.undoneAt) throw new MergeError(`Merge ${mergeId} was already undone.`)
    const undo: UndoData | undefined = (merge.report as any)?.undo
    if (!undo) throw new MergeError(`Merge ${mergeId} has no undo data.`)
    const { keepId, removeId } = merge as { keepId: string; removeId: string }
    const remove = await db.member.findUnique({ where: { id: removeId } })
    if (!remove || remove.mergedInto !== keepId) throw new MergeError(`Member ${removeId} is not currently merged into ${keepId}.`)
    const later = await db.memberMerge.count({ where: { keepId: removeId } })
    if (later > 0) throw new MergeError(`Member ${removeId} was itself the keeper of another merge; undo that one first.`)

    const rep: UnmergeReport = { mergeId, keepId, removeId, dryRun: !write, movedBack: 0, restoredRows: 0, conflicts: [], pep: undo.pep, notes: [] }

    // PEP first: if the keeper spent it, the whole undo is refused (nothing has been written yet).
    if (write && undo.pep) {
      const { creditInTx, debitInTx, lockWallet } = await import('@/app/lib/economy')
      const { amount, fromDiscordId, toDiscordId } = undo.pep
      for (const id of [fromDiscordId, toDiscordId].sort()) await lockWallet(db, id)
      const memo = `UNMERGE: member ${removeId} restored from ${keepId}`
      const metadata = { unmerge: true, mergeId, keepId, removeId }
      await debitInTx(db, toDiscordId, amount, 'ADMIN_REMOVE', memo, metadata)
      await creditInTx(db, fromDiscordId, amount, 'ADMIN_GRANT', memo, metadata)
    }

    for (const g of undo.deleted) {
      const d = db[delegateName(g.model)]
      for (const row of g.rows) {
        const existing = await d.findUnique({ where: { [g.pk]: row[g.pk] } })
        if (existing) {
          rep.conflicts.push(`${g.model} ${String(row[g.pk])} already exists; not restored`)
          continue
        }
        rep.restoredRows++
        if (write) {
          const data = Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null))
          await d.create({ data })
        }
      }
    }
    for (const m of undo.moved) {
      const d = db[delegateName(m.model)]
      const where = { [m.pk]: { in: m.ids }, [m.field]: keepId }
      const n = await d.count({ where })
      rep.movedBack += n
      if (write && n > 0) await d.updateMany({ where, data: { [m.field]: removeId } })
    }
    if (write) {
      for (const a of undo.adjusted) await db[delegateName(a.model)].update({ where: { [a.pk]: a.id }, data: { [a.field]: a.before } })
      for (const a of undo.arrays) {
        const d = db[delegateName(a.model)]
        const row = await d.findUnique({ where: { id: a.id } })
        if (!row) continue
        const current: string[] = row[a.field] ?? []
        // Put removeId back where it was, but keep any ids added since the merge.
        const extra = current.filter((x) => x !== keepId && !a.before.includes(x))
        const next = [...new Set([...a.before as string[], ...extra])]
        await d.update({ where: { id: a.id }, data: { [a.field]: next } })
      }
      if (undo.keepBefore) {
        await db.member.update({ where: { id: keepId }, data: { discordId: undo.keepBefore.discordId, cells: undo.keepBefore.cells as any, updatedBy: `member-unmerge:${actor}` } })
      }
      if (undo.removeBefore) {
        await db.member.update({
          where: { id: removeId },
          data: { discordId: undo.removeBefore.discordId, cells: undo.removeBefore.cells as any, mergedInto: null, mergedAt: null, updatedBy: `member-unmerge:${actor}` },
        })
      }
      await db.memberMerge.update({ where: { id: mergeId }, data: { undoneAt: new Date(), undoneBy: actor } })
    }
    rep.notes.push('Rows created for the kept member after the merge stay with the kept member.')
    return rep
  }

  if (dryRun) return run(prisma, false)
  const report: UnmergeReport = await prisma.$transaction(
    async (tx: any) => {
      await lockAll(tx)
      return run(tx, true)
    },
    { timeout: 120_000, maxWait: 15_000 },
  )
  await expireCache(deps)
  return report
}
