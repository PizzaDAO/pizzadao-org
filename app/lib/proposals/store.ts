/**
 * Proposal mutations and reads (plans/proposals-voting.md).
 *
 * Secrecy rules pinned here:
 *  - a ballot row holds {proposalId, tokenHash, choice} and nothing else: no member id, no timestamp, no IP;
 *  - the vote path (castBallot) takes no session and never logs a token or a choice;
 *  - the member's side (issueToken) records only "token issued to member X for proposal P", once, never again;
 *  - issuance happens when a member loads a page, voting later, in a different request: no timing link.
 *
 * Money/authority rules: the eligibility set and the pass rule are copied onto the proposal when it opens;
 * settling runs inside one transaction that locks the proposal row, so a vote and the count serialize.
 */
import { prisma } from '@/app/lib/db'
import { CLOSE_MARGIN_MS, COUNT_ABSTAINS, DAY_MS, DRAFT_RETRY_MS, REQUIRE_AYES_OVER_NAYS } from './constants'
import { loadPilotState } from './pilot'
import { BACKUP_BLOB_LENGTH } from './backup'
import { defaultRoleDeps, snapshotRoleHolders, type RoleDeps } from './eligibility'
import { generateProposalKeyPair, wrapPrivateKey } from './keys'
import { ayesNeededFor, loadProposalRules, type ProposalRules } from './rules'
import { countBallots, tallyProposal } from './tally'
import { defaultPendingStore, sortedByHash, type PendingStore } from './pending'
import { ballotKey, signBlinded, verifyBallotCredentials, type BallotCredentials } from './token'
import type { NewProposal } from './validate'

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]
export type Choice = 'AYE' | 'NAY' | 'ABSTAIN'

/** `undefined` = use Redis when configured; `null` = no Redis (write straight to the database). */
type PendingOpt = PendingStore | null | undefined
const pendingFor = (o: PendingOpt, env: NodeJS.ProcessEnv = process.env): PendingStore | null => (o === undefined ? defaultPendingStore(env) : o)

/**
 * A real deployment (NODE_ENV=production) never writes votes straight to the table: without the pending store the
 * database's row order and history would follow vote time. The direct path exists for tests and local runs only.
 */
const directWriteAllowed = (env: NodeJS.ProcessEnv): boolean => env.NODE_ENV !== 'production'

/** Interactive transactions that move many rows need more than the 5 s default. */
const BIG_TX = { timeout: 30_000, maxWait: 10_000 } as const
export const CHOICES: readonly Choice[] = ['AYE', 'NAY', 'ABSTAIN']

/** Row lock so a vote and a settle on the same proposal serialize. */
function lockProposal(tx: Tx, id: string) {
  return tx.$queryRaw`SELECT id FROM "Proposal" WHERE id = ${id} FOR UPDATE`
}

function logEvent(tx: Tx, proposalId: string, type: string, actorDiscordId: string | null, data?: Record<string, unknown>) {
  return tx.proposalEvent.create({ data: { proposalId, type, actorDiscordId, data: (data ?? undefined) as never } })
}

/** Day precision on purpose: an exact issue time would narrow down when a member's browser fetched its token. */
export function dayStart(d: Date): Date {
  return new Date(Math.floor(d.getTime() / DAY_MS) * DAY_MS)
}

// ------------------------------------------------------------------ create

export async function createProposal(input: NewProposal & { proposerDiscordId: string; beneficiaryDiscordId?: string | null; isTest?: boolean }): Promise<{ id: string }> {
  return prisma.$transaction(async (tx) => {
    const row = await tx.proposal.create({
      data: {
        kind: input.kind,
        title: input.title,
        body: input.body,
        amountUsdCents: input.amountUsdCents,
        eventDate: input.eventDate,
        city: input.city,
        proposerDiscordId: input.proposerDiscordId,
        sponsorLabel: input.sponsorLabel,
        beneficiaryDiscordId: input.beneficiaryDiscordId && input.beneficiaryDiscordId !== input.proposerDiscordId ? input.beneficiaryDiscordId : null,
        isTest: input.isTest === true,
        countAbstains: COUNT_ABSTAINS,
        requireAyesOverNays: REQUIRE_AYES_OVER_NAYS,
      },
      select: { id: true },
    })
    await logEvent(tx, row.id, 'CREATED', input.proposerDiscordId, { kind: input.kind, ...(input.isTest ? { test: true } : {}) })
    return row
  })
}

// -------------------------------------------------------------------- open

/** Voting is production-only: previews share the production database, so they must never open, issue or count. */
export function isProduction(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VERCEL_ENV === 'production'
}

export type OpenResult =
  | { ok: true; eligible: number }
  | { ok: false; code: 'not_found' | 'not_draft' | 'not_production' | 'no_redis' | 'pilot_over' }

/**
 * Open a DRAFT proposal: list the voter-role holders (strict: any Discord failure aborts), generate this proposal's
 * own signing key pair, copy the rules onto it and start the window. The slow parts run outside the transaction;
 * the transaction only lands if the proposal is still a DRAFT, so a second open attempt changes nothing.
 */
export async function openProposal(
  id: string,
  opts: { now?: Date; deps?: RoleDeps; rules?: ProposalRules; env?: NodeJS.ProcessEnv; keyBits?: number; pending?: PendingOpt; pilot?: readonly string[] } = {},
): Promise<OpenResult> {
  const env = opts.env ?? process.env
  if (!isProduction(env)) return { ok: false, code: 'not_production' }
  // Votes need the pending store in production: do not open a proposal that could not take them.
  if (!pendingFor(opts.pending, env) && !directWriteAllowed(env)) return { ok: false, code: 'no_redis' }
  const now = opts.now ?? new Date()
  const p = await prisma.proposal.findUnique({ where: { id }, select: { status: true, kind: true, amountUsdCents: true, source: true, isTest: true } })
  if (!p) return { ok: false, code: 'not_found' }
  // Imported history is never opened: it has no voter snapshot and no key.
  if (p.source === 'IMPORTED') return { ok: false, code: 'not_draft' }
  if (p.status !== 'DRAFT') return { ok: false, code: 'not_draft' }
  const rules = opts.rules ?? (await loadProposalRules())
  // A pilot (test) proposal: only the listed testers vote, the window is short and one aye is enough.
  // If the pilot has ended meanwhile it never opens (it would have no sensible voter set): it is cancelled.
  let pilot: string[] = []
  if (p.isTest) {
    if (opts.pilot) pilot = [...opts.pilot]
    else {
      const st = await loadPilotState()
      // An unreadable list must not cancel a test proposal: fail, and the cron retries.
      if (st.unknown) throw new Error('pilot list unreadable')
      pilot = st.ids
    }
  }
  if (p.isTest && pilot.length === 0) {
    await prisma.$transaction(async (tx) => {
      await lockProposal(tx, id)
      const fresh = await tx.proposal.findUnique({ where: { id }, select: { status: true } })
      if (fresh?.status !== 'DRAFT') return
      await tx.proposal.update({ where: { id }, data: { status: 'CANCELLED', closedAt: now } })
      await logEvent(tx, id, 'CANCELLED', null, { reason: 'pilot_over' })
    })
    return { ok: false, code: 'pilot_over' }
  }
  const full = await snapshotRoleHolders(opts.deps ?? defaultRoleDeps)
  const snap = p.isTest ? { ...full, discordIds: full.discordIds.filter((d) => pilot.includes(d)) } : full
  const pair = await generateProposalKeyPair(opts.keyBits)
  const keyPrivateEnc = await wrapPrivateKey(pair.privatePem, id, env)
  const windowMs = p.isTest ? (rules.pilotWindowMinutes ?? 60) * 60 * 1000 : rules.windowDays * DAY_MS
  const closesAt = new Date(now.getTime() + windowMs)
  const ayesNeeded = p.isTest ? 1 : ayesNeededFor(p.kind, p.amountUsdCents, rules)
  return prisma.$transaction(async (tx) => {
    await lockProposal(tx, id)
    const fresh = await tx.proposal.findUnique({ where: { id }, select: { status: true } })
    if (!fresh || fresh.status !== 'DRAFT') return { ok: false as const, code: 'not_draft' as const }
    if (snap.discordIds.length > 0) {
      await tx.proposalVoter.createMany({ data: snap.discordIds.map((discordId) => ({ proposalId: id, discordId })), skipDuplicates: true })
    }
    await tx.proposal.update({
      where: { id },
      data: {
        status: 'OPEN',
        opensAt: now,
        closesAt,
        ayesNeeded,
        countAbstains: COUNT_ABSTAINS,
        requireAyesOverNays: REQUIRE_AYES_OVER_NAYS,
        eligibleCount: snap.discordIds.length,
        voterRoleId: snap.roleId,
        keyPublicPem: pair.publicPem,
        keyFingerprint: pair.fingerprint,
        keyPrivateEnc,
      },
    })
    await logEvent(tx, id, 'OPENED', null, { eligible: snap.discordIds.length, ayesNeeded, ...(p.isTest ? { test: true, windowMinutes: windowMs / 60000 } : { windowDays: rules.windowDays }) })
    return { ok: true as const, eligible: snap.discordIds.length }
  })
}

/** Proposals a member has waiting or open right now (the per-proposer cap). */
export async function countActiveFor(proposerDiscordId: string): Promise<number> {
  return prisma.proposal.count({ where: { source: 'APP', proposerDiscordId, status: { in: ['DRAFT', 'OPEN'] } } })
}

// ------------------------------------------------------------------ cancel

export type CancelActor = { discordId: string; admin: boolean }
export type CancelResult =
  | { ok: true; wasOpen: boolean; discordChannelId: string | null; discordMessageId: string | null }
  | { ok: false; code: 'not_found' | 'not_cancellable' | 'not_allowed' | 'bad_reason' }

/**
 * Cancel (admin) or withdraw (the proposer) a proposal that has not been counted. Admins: a DRAFT, or an OPEN proposal
 * until the window ends. The proposer: their own DRAFT, or their own OPEN proposal until the window ends.
 * Under the row lock it sets CANCELLED and closedAt, logs the actor and reason, and deletes the ballot rows; after the
 * commit it deletes the pending hash. A cancelled proposal is never counted, so nothing it held can matter.
 */
export async function cancelProposal(
  id: string,
  actor: CancelActor,
  reason: unknown,
  opts: { now?: Date; pending?: PendingOpt } = {},
): Promise<CancelResult> {
  const now = opts.now ?? new Date()
  const text = typeof reason === 'string' ? reason.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, 300) : ''
  if (actor.admin && text.length < 3) return { ok: false, code: 'bad_reason' }
  const result = await prisma.$transaction(async (tx) => {
    await lockProposal(tx, id)
    const p = await tx.proposal.findUnique({
      where: { id },
      select: { status: true, source: true, proposerDiscordId: true, closesAt: true, discordChannelId: true, discordMessageId: true },
    })
    if (!p || p.source !== 'APP') return { ok: false as const, code: 'not_found' as const }
    if (p.status !== 'DRAFT' && p.status !== 'OPEN') return { ok: false as const, code: 'not_cancellable' as const }
    // Once the window has ended the votes are in: nobody (admins included) can cancel it any more; it settles.
    if (p.status === 'OPEN' && (!p.closesAt || now >= p.closesAt)) return { ok: false as const, code: 'not_cancellable' as const }
    if (!actor.admin && (!p.proposerDiscordId || p.proposerDiscordId !== actor.discordId)) return { ok: false as const, code: 'not_allowed' as const }
    const wasOpen = p.status === 'OPEN'
    const { discordChannelId, discordMessageId } = p
    await tx.proposal.update({ where: { id }, data: { status: 'CANCELLED', closedAt: now } })
    await tx.proposalBallot.deleteMany({ where: { proposalId: id } })
    await logEvent(tx, id, 'CANCELLED', actor.discordId, { by: actor.admin ? 'admin' : 'proposer', reason: text || null, wasOpen })
    return { ok: true as const, wasOpen, discordChannelId, discordMessageId }
  })
  if (result.ok) {
    const store = pendingFor(opts.pending)
    if (store) await store.clear(id).catch((e) => console.error('[proposals] pending clear failed:', (e as Error)?.name))
  }
  return result
}

/** The proposal's public voting key and fingerprint (null until it has opened). */
export async function getPublicKey(proposalId: string): Promise<{ publicKey: string; fingerprint: string } | null> {
  const p = await prisma.proposal.findUnique({ where: { id: proposalId }, select: { keyPublicPem: true, keyFingerprint: true } })
  return p?.keyPublicPem && p.keyFingerprint ? { publicKey: p.keyPublicPem, fingerprint: p.keyFingerprint } : null
}

// ------------------------------------------------------------ token issue

export type IssueResult =
  | { ok: true; blindSignature: string }
  | { ok: false; code: 'not_found' | 'closed' | 'not_eligible' | 'already_issued' | 'bad_request' | 'not_production' }

/**
 * Sign a blinded ballot token for an eligible member, once per proposal. The server never sees the token.
 * The signature is computed first and handed out only after the one-time claim succeeds, so a lost race
 * returns nothing. A response lost in transit cannot be re-issued (by design: one token, ever).
 */
export async function issueToken(
  proposalId: string,
  discordId: string,
  blindedMessage: unknown,
  opts: { now?: Date; env?: NodeJS.ProcessEnv } = {},
): Promise<IssueResult> {
  const env = opts.env ?? process.env
  if (!isProduction(env)) return { ok: false, code: 'not_production' }
  const now = opts.now ?? new Date()
  if (typeof blindedMessage !== 'string' || blindedMessage.length < 150 || blindedMessage.length > 2000) return { ok: false, code: 'bad_request' }
  const p = await prisma.proposal.findUnique({ where: { id: proposalId }, select: { id: true, status: true, closesAt: true, keyPrivateEnc: true } })
  if (!p) return { ok: false, code: 'not_found' }
  if (p.status !== 'OPEN' || !p.closesAt || now >= p.closesAt) return { ok: false, code: 'closed' }
  const voter = await prisma.proposalVoter.findUnique({
    where: { proposalId_discordId: { proposalId, discordId } },
    select: { tokenIssuedAt: true },
  })
  if (!voter) return { ok: false, code: 'not_eligible' }
  if (voter.tokenIssuedAt) return { ok: false, code: 'already_issued' }
  let blindSignature: string
  try {
    blindSignature = await signBlinded(p, blindedMessage, env)
  } catch (e) {
    if (e instanceof Error && e.message === 'bad blinded message') return { ok: false, code: 'bad_request' }
    throw e
  }
  const claimed = await prisma.proposalVoter.updateMany({
    where: { proposalId, discordId, tokenIssuedAt: null },
    data: { tokenIssuedAt: dayStart(now) },
  })
  if (claimed.count !== 1) return { ok: false, code: 'already_issued' }
  return { ok: true, blindSignature }
}

// ----------------------------------------------------------- ballot backup

/**
 * Optional wallet-encrypted ballot backup. The server stores ciphertext only: the key is derived in the browser
 * from a wallet signature that never leaves it. Replaces any earlier backup.
 */
export async function saveBallotBlob(proposalId: string, discordId: string, blob: unknown): Promise<'ok' | 'not_eligible' | 'bad_request' | 'exists'> {
  // One exact length (the browser pads before encrypting), so the size says nothing about the contents.
  if (typeof blob !== 'string' || blob.length !== BACKUP_BLOB_LENGTH || !/^[A-Za-z0-9_-]+$/.test(blob)) return 'bad_request'
  // Written once: the backup holds the ballot credentials only, which never change, so there is nothing to overwrite.
  const r = await prisma.proposalVoter.updateMany({ where: { proposalId, discordId, ballotBlob: null }, data: { ballotBlob: blob } })
  if (r.count === 1) return 'ok'
  const v = await prisma.proposalVoter.findUnique({ where: { proposalId_discordId: { proposalId, discordId } }, select: { ballotBlob: true } })
  return v ? 'exists' : 'not_eligible'
}

export async function getBallotBlob(proposalId: string, discordId: string): Promise<{ eligible: boolean; blob: string | null }> {
  const v = await prisma.proposalVoter.findUnique({ where: { proposalId_discordId: { proposalId, discordId } }, select: { ballotBlob: true } })
  return { eligible: !!v, blob: v?.ballotBlob ?? null }
}

// -------------------------------------------------------------------- vote

export type BallotResult =
  | { ok: true }
  | { ok: false; code: 'not_found' | 'closed' | 'bad_request' | 'invalid_token' | 'not_production' | 'unavailable' }

/**
 * Record (or replace) a ballot. No session, no member id: the signature on the token is the only credential.
 * The ballot is keyed by hash(proposalId + token), so the same token replaces the choice until the proposal closes.
 *
 * With Redis configured the vote is written to the pending hash (see pending.ts) and `ok` means that write succeeded;
 * the hourly cron (and settle) move pending votes into the table in one sorted transaction. If that write fails the
 * answer is `unavailable` and the browser retries; nothing is half-saved. Without Redis the row is written directly.
 */
export async function castBallot(
  proposalId: string,
  creds: BallotCredentials,
  choice: unknown,
  opts: { now?: Date; env?: NodeJS.ProcessEnv; pending?: PendingOpt } = {},
): Promise<BallotResult> {
  if (!isProduction(opts.env ?? process.env)) return { ok: false, code: 'not_production' }
  const now = opts.now ?? new Date()
  if (typeof choice !== 'string' || !(CHOICES as readonly string[]).includes(choice)) return { ok: false, code: 'bad_request' }
  if (![creds.token, creds.preparedMessage, creds.signature].every((v) => typeof v === 'string' && v.length > 0 && v.length < 4000)) {
    return { ok: false, code: 'bad_request' }
  }
  const p = await prisma.proposal.findUnique({ where: { id: proposalId }, select: { id: true, status: true, closesAt: true, keyPublicPem: true } })
  if (!p) return { ok: false, code: 'not_found' }
  if (p.status !== 'OPEN' || !p.closesAt || now >= p.closesAt) return { ok: false, code: 'closed' }
  const bad = await verifyBallotCredentials(p, creds)
  if (bad) return { ok: false, code: 'invalid_token' }
  const tokenHash = await ballotKey(proposalId, creds.token)
  const env = opts.env ?? process.env
  const store = pendingFor(opts.pending, env)
  if (!store && !directWriteAllowed(env)) return { ok: false, code: 'unavailable' }
  if (store) {
    // The clock is read again right before the write: the checks above took time, and a vote must not land after the close.
    if ((opts.now ?? new Date()) >= p.closesAt) return { ok: false, code: 'closed' }
    try {
      await store.put(proposalId, tokenHash, choice as Choice)
    } catch {
      return { ok: false, code: 'unavailable' }
    }
    // A cancel may have landed between the check above and the write: re-check, and clear the hash again if so, so
    // a vote racing a cancel leaves no orphan in Redis.
    const after = await prisma.proposal.findUnique({ where: { id: proposalId }, select: { status: true } })
    if (!after || after.status !== 'OPEN') {
      await store.clear(proposalId).catch(() => {})
      return { ok: false, code: 'closed' }
    }
    return { ok: true }
  }
  return prisma.$transaction(async (tx) => {
    // Re-check under the row lock: a settle that already counted must not be followed by a late vote.
    await lockProposal(tx, proposalId)
    const fresh = await tx.proposal.findUnique({ where: { id: proposalId }, select: { status: true, closesAt: true } })
    if (!fresh || fresh.status !== 'OPEN' || !fresh.closesAt || now >= fresh.closesAt) return { ok: false as const, code: 'closed' as const }
    await tx.proposalBallot.upsert({
      where: { proposalId_tokenHash: { proposalId, tokenHash } },
      create: { proposalId, tokenHash, choice: choice as Choice },
      update: { choice: choice as Choice },
    })
    return { ok: true as const }
  })
}

// ------------------------------------------------------------------ settle

export type SettleResult =
  | { ok: true; outcome: 'passed' | 'failed'; ayes: number; nays: number; abstains: number }
  | { ok: false; code: 'not_found' | 'not_open' | 'not_due' }

type BallotWrite = { tokenHash: string; choice: Choice }

/**
 * Write pending ballots in bulk, in tokenHash order (so insertion order carries no vote-time information): one
 * createMany (skipDuplicates) for hashes that have no row yet, then one updateMany per choice for the existing ones.
 */
async function writeBallots(tx: Tx, proposalId: string, entries: readonly BallotWrite[]) {
  if (entries.length === 0) return
  const sorted = sortedByHash(entries)
  const have = new Set<string>(
    (await tx.proposalBallot.findMany({ where: { proposalId, tokenHash: { in: sorted.map((e) => e.tokenHash) } }, select: { tokenHash: true } })).map(
      (r: { tokenHash: string }) => r.tokenHash,
    ),
  )
  const fresh = sorted.filter((e) => !have.has(e.tokenHash))
  if (fresh.length) await tx.proposalBallot.createMany({ data: fresh.map((e) => ({ proposalId, tokenHash: e.tokenHash, choice: e.choice })), skipDuplicates: true })
  for (const choice of CHOICES) {
    const hashes = sorted.filter((e) => have.has(e.tokenHash) && e.choice === choice).map((e) => e.tokenHash)
    if (hashes.length) await tx.proposalBallot.updateMany({ where: { proposalId, tokenHash: { in: hashes } }, data: { choice } })
  }
}

/**
 * Move a proposal's pending votes into the ballot table in ONE transaction (sorted by tokenHash), then delete only the
 * pending fields that still hold what was moved. The pending hash is read INSIDE the transaction, after the row lock,
 * so two drains (or a drain and a settle) can never write an older read over a newer one. Safe to repeat or interrupt:
 * a crash before the delete means the next run re-writes the same values; a vote changed meanwhile stays pending.
 */
export async function drainPending(proposalId: string, opts: { pending?: PendingOpt } = {}): Promise<number> {
  const store = pendingFor(opts.pending)
  if (!store) return 0
  const entries = await prisma.$transaction(async (tx) => {
    await lockProposal(tx, proposalId)
    const p = await tx.proposal.findUnique({ where: { id: proposalId }, select: { status: true } })
    if (!p || p.status !== 'OPEN') return [] as BallotWrite[]
    const pending = await store.all(proposalId)
    await writeBallots(tx, proposalId, pending)
    return pending
  }, BIG_TX)
  if (entries.length === 0) return 0
  await store.removeIfUnchanged(proposalId, entries)
  return entries.length
}

/**
 * Count a proposal that is due, CLOSE_MARGIN_MS after closesAt. Idempotent: only an OPEN proposal settles, once.
 * Pending votes are read and moved in first, under the lock.
 */
export async function settleProposal(id: string, now: Date = new Date(), opts: { pending?: PendingOpt } = {}): Promise<SettleResult> {
  const store = pendingFor(opts.pending)
  let drained: BallotWrite[] = []
  const result = await prisma.$transaction(async (tx) => {
    await lockProposal(tx, id)
    const p = await tx.proposal.findUnique({
      where: { id },
      select: { status: true, closesAt: true, ayesNeeded: true, countAbstains: true, requireAyesOverNays: true },
    })
    if (!p) return { ok: false as const, code: 'not_found' as const }
    if (p.status !== 'OPEN' || !p.closesAt || p.ayesNeeded == null) return { ok: false as const, code: 'not_open' as const }
    if (now.getTime() < p.closesAt.getTime() + CLOSE_MARGIN_MS) return { ok: false as const, code: 'not_due' as const }
    // Votes are only accepted before closesAt, so everything pending belongs in this count.
    drained = store ? await store.all(id) : []
    if (drained.length) await writeBallots(tx, id, drained)
    const ballots = await tx.proposalBallot.findMany({ where: { proposalId: id }, select: { choice: true } })
    const t = tallyProposal(countBallots(ballots), { ayesNeeded: p.ayesNeeded, countAbstains: p.countAbstains, requireAyesOverNays: p.requireAyesOverNays }, now, p.closesAt)
    if (t.outcome === 'pending') return { ok: false as const, code: 'not_due' as const }
    const outcome = t.outcome
    await tx.proposal.update({
      where: { id },
      data: { status: outcome === 'passed' ? 'PASSED' : 'FAILED', closedAt: now, ayes: t.ayes, nays: t.nays, abstains: t.abstains },
    })
    await logEvent(tx, id, 'CLOSED', null, { outcome, ayes: t.ayes, nays: t.nays, abstains: t.abstains })
    return { ok: true as const, outcome, ayes: t.ayes, nays: t.nays, abstains: t.abstains }
  }, BIG_TX)
  // After the commit; if this fails the closed proposal just keeps stale pending fields that nothing reads.
  if (result.ok && store && drained.length) await store.removeIfUnchanged(id, drained).catch(() => {})
  return result
}

// ------------------------------------------------------------------- reads

export interface ProposalSummary {
  id: string
  kind: 'FUNDING' | 'GENERAL'
  status: 'DRAFT' | 'OPEN' | 'PASSED' | 'FAILED' | 'CANCELLED' | 'UNRESOLVED'
  title: string
  amountUsd: number | null
  city: string | null
  opensAt: string | null
  closesAt: string | null
  /** Only for a settled proposal: counts stay hidden while voting is open. */
  result: { ayes: number; nays: number; abstains: number; ayesNeeded: number | null } | null
  /** Imported history: a read-only record. App proposals are 'APP'. */
  source: 'APP' | 'IMPORTED'
  /** Imported rows: paidOverride, else whether any payment is recorded. */
  paid: boolean
  /** Payment total in USD (imported rows). */
  paidUsd: number | null
  proposerLabel: string | null
  /** When the proposal was made (the poll post), ISO. */
  proposedAt: string | null
  votesRecorded: boolean
  /** Imported rows with recorded votes. Never used for the vote UI. */
  votes: { ayes: number; nays: number; abstains: number } | null
  /** Whitelisted keys of the imported `historical` JSON. */
  historical: HistoricalInfo | null
}

export interface HistoricalInfo {
  amountRaw?: string
  quorumStated?: number
  sheetStatus?: string
  eventDateRaw?: string
  resubmissionOf?: string
  discussVotes?: number
  partlyPaid?: boolean
  reactions?: Array<{ emoji: string; count: number }>
}

/** Only these keys of the stored JSON ever reach a page; everything else (notes, derived values) stays in the database. */
export function whitelistHistorical(v: unknown): HistoricalInfo | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  const out: HistoricalInfo = {}
  if (typeof o.amountRaw === 'string') out.amountRaw = o.amountRaw.slice(0, 300)
  if (typeof o.quorumStated === 'number') out.quorumStated = o.quorumStated
  if (typeof o.sheetStatus === 'string') out.sheetStatus = o.sheetStatus.slice(0, 40)
  if (typeof o.eventDateRaw === 'string') out.eventDateRaw = o.eventDateRaw.slice(0, 60)
  if (typeof o.resubmissionOf === 'string') out.resubmissionOf = o.resubmissionOf.slice(0, 60)
  if (typeof o.discussVotes === 'number') out.discussVotes = o.discussVotes
  if (o.partlyPaid === true) out.partlyPaid = true
  if (Array.isArray(o.reactions)) {
    out.reactions = (o.reactions as unknown[])
      .filter((r): r is { emoji: string; count: number } => !!r && typeof (r as { emoji?: unknown }).emoji === 'string' && typeof (r as { count?: unknown }).count === 'number')
      .slice(0, 12)
      .map((r) => ({ emoji: r.emoji.slice(0, 40), count: r.count }))
  }
  return out
}

export type ProposalRow = {
  id: string; kind: 'FUNDING' | 'GENERAL'; status: ProposalSummary['status']; title: string; amountUsdCents: number | null
  city: string | null; opensAt: Date | null; closesAt: Date | null; ayes: number; nays: number; abstains: number; ayesNeeded: number | null
  source?: 'APP' | 'IMPORTED'; paidOverride?: boolean | null; proposerLabel?: string | null; createdAt?: Date | null; votesRecorded?: boolean; historical?: unknown
  historyPayments?: Array<{ usdValue: number | null; source?: string }>
}

export const SUMMARY_SELECT = {
  id: true, kind: true, status: true, title: true, amountUsdCents: true, city: true, opensAt: true, closesAt: true,
  ayes: true, nays: true, abstains: true, ayesNeeded: true,
  source: true, paidOverride: true, proposerLabel: true, createdAt: true, votesRecorded: true, historical: true,
  historyPayments: { select: { usdValue: true, source: true } },
} as const

export function toSummary(r: ProposalRow): ProposalSummary {
  const imported = r.source === 'IMPORTED'
  // Imported rows never show the app's result line (it states today's rule); they carry `votes` instead.
  const settled = !imported && (r.status === 'PASSED' || r.status === 'FAILED')
  const pays = r.historyPayments ?? []
  const paid = imported ? (r.paidOverride ?? pays.length > 0) : false
  let paidCents: number | null = null
  if (imported && paid) {
    const sum = pays.reduce((n, x) => n + (x.usdValue ?? 0), 0)
    paidCents = sum === 0 && (pays.length === 0 || pays.some((x) => x.usdValue == null && (x.source === 'sheet' || x.source === 'override'))) ? (r.amountUsdCents ?? null) : sum
  }
  return {
    source: imported ? 'IMPORTED' : 'APP',
    paid,
    paidUsd: paidCents == null ? null : paidCents / 100,
    proposerLabel: r.proposerLabel ?? null,
    proposedAt: (imported ? (r.opensAt ?? r.createdAt) : null)?.toISOString() ?? null,
    votesRecorded: r.votesRecorded ?? true,
    votes: imported && (r.votesRecorded ?? true) ? { ayes: r.ayes, nays: r.nays, abstains: r.abstains } : null,
    historical: imported ? whitelistHistorical(r.historical) : null,
    id: r.id,
    kind: r.kind,
    status: r.status,
    title: r.title,
    amountUsd: r.amountUsdCents == null ? null : r.amountUsdCents / 100,
    city: r.city,
    opensAt: r.opensAt?.toISOString() ?? null,
    closesAt: r.closesAt?.toISOString() ?? null,
    result: settled ? { ayes: r.ayes, nays: r.nays, abstains: r.abstains, ayesNeeded: r.ayesNeeded } : null,
  }
}

export interface ViewerState {
  /** In the eligibility snapshot taken when the proposal opened. */
  eligible: boolean
  /** A ballot token was already issued (so none is issued again). */
  tokenIssued: boolean
}

export async function viewerStates(proposalIds: string[], discordId: string): Promise<Record<string, ViewerState>> {
  if (proposalIds.length === 0) return {}
  const rows = await prisma.proposalVoter.findMany({
    where: { discordId, proposalId: { in: proposalIds } },
    select: { proposalId: true, tokenIssuedAt: true },
  })
  const out: Record<string, ViewerState> = {}
  for (const r of rows as Array<{ proposalId: string; tokenIssuedAt: Date | null }>) out[r.proposalId] = { eligible: true, tokenIssued: !!r.tokenIssuedAt }
  return out
}

export async function listProposals(recentLimit = 30): Promise<{ open: ProposalSummary[]; recent: ProposalSummary[] }> {
  const [open, recent] = await Promise.all([
    prisma.proposal.findMany({ where: { source: 'APP', isTest: false, status: { in: ['DRAFT', 'OPEN'] } }, orderBy: { createdAt: 'desc' }, take: 100, select: SUMMARY_SELECT }),
    prisma.proposal.findMany({ where: { source: 'APP', isTest: false, status: { in: ['PASSED', 'FAILED'] } }, orderBy: { closedAt: 'desc' }, take: recentLimit, select: SUMMARY_SELECT }),
  ])
  return { open: (open as ProposalRow[]).map(toSummary), recent: (recent as ProposalRow[]).map(toSummary) }
}

/**
 * The proposals open for voting (and drafts about to open): app proposals only. Test (pilot) proposals are left out
 * unless `includeTest` (a pilot tester looking at the list); they never reach history, totals or the payments picker.
 */
export async function listOpenProposals(opts: { includeTest?: boolean } = {}): Promise<ProposalSummary[]> {
  const rows = await prisma.proposal.findMany({
    where: { source: 'APP', ...(opts.includeTest ? {} : { isTest: false }), status: { in: ['DRAFT', 'OPEN'] } },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: SUMMARY_SELECT,
  })
  return (rows as ProposalRow[]).map(toSummary)
}

/** Open proposals this member is in the voter snapshot for (id, title, close time, token already issued?). */
export async function openForViewer(discordId: string): Promise<Array<{ id: string; title: string; closesAt: string | null; tokenIssued: boolean }>> {
  const rows = await prisma.proposalVoter.findMany({
    where: { discordId, proposal: { status: 'OPEN' } },
    select: { proposalId: true, tokenIssuedAt: true, proposal: { select: { title: true, closesAt: true } } },
  })
  return (rows as Array<{ proposalId: string; tokenIssuedAt: Date | null; proposal: { title: string; closesAt: Date | null } }>).map((r) => ({
    id: r.proposalId,
    title: r.proposal.title,
    closesAt: r.proposal.closesAt?.toISOString() ?? null,
    tokenIssued: !!r.tokenIssuedAt,
  }))
}

export interface ProposalDetail extends ProposalSummary {
  keyFingerprint: string | null
  body: string
  eventDate: string | null
  sponsorLabel: string | null
  ayesNeeded: number | null
  eligibleCount: number | null
  isProposer: boolean
  /** The viewer is the proposer and it is not over: waiting to open, or open and before the window ends. */
  withdrawable: boolean
  outcomeSource: string | null
  /** Optional member who may file the payment requests (named by the proposer). */
  beneficiaryDiscordId: string | null
  isTest: boolean
  /** A DRAFT that should have opened by now: an open attempt failed, or it has waited a while. */
  openDelayed: boolean
}

/** A draft that has waited this long without opening is shown as delayed. */
export const OPEN_DELAYED_AFTER_MS = 10 * 60 * 1000

export async function getProposalDetail(id: string, viewerDiscordId: string): Promise<ProposalDetail | null> {
  const r = await prisma.proposal.findUnique({
    where: { id },
    select: { ...SUMMARY_SELECT, body: true, eventDate: true, sponsorLabel: true, eligibleCount: true, proposerDiscordId: true, keyFingerprint: true, outcomeSource: true, beneficiaryDiscordId: true, isTest: true },
  })
  if (!r) return null
  let openDelayed = false
  if (r.status === 'DRAFT' && r.source !== 'IMPORTED') {
    const failed = await prisma.proposalEvent.findFirst({ where: { proposalId: id, type: 'OPEN_FAILED' }, select: { id: true } }).catch(() => null)
    openDelayed = !!failed || (!!r.createdAt && Date.now() - new Date(r.createdAt).getTime() > OPEN_DELAYED_AFTER_MS)
  }
  return {
    ...toSummary(r as ProposalRow),
    body: r.body,
    keyFingerprint: r.keyFingerprint,
    eventDate: r.eventDate ? r.eventDate.toISOString().slice(0, 10) : null,
    sponsorLabel: r.sponsorLabel,
    ayesNeeded: r.ayesNeeded,
    eligibleCount: r.eligibleCount,
    isProposer: !!r.proposerDiscordId && r.proposerDiscordId === viewerDiscordId,
    withdrawable:
      r.source !== 'IMPORTED' &&
      !!r.proposerDiscordId &&
      r.proposerDiscordId === viewerDiscordId &&
      (r.status === 'DRAFT' || (r.status === 'OPEN' && !!r.closesAt && r.closesAt.getTime() > Date.now())),
    outcomeSource: r.outcomeSource ?? null,
    beneficiaryDiscordId: r.beneficiaryDiscordId ?? null,
    isTest: r.isTest === true,
    openDelayed,
  }
}

/** Passed funding proposals the member filed or is the named beneficiary of, newest first: the ones a payment request can link to. Never test proposals. */
export async function passedFundingProposalsFor(discordId: string): Promise<Array<{ id: string; title: string; amountUsd: number }>> {
  const rows = await prisma.proposal.findMany({
    where: { source: 'APP', isTest: false, kind: 'FUNDING', status: 'PASSED', OR: [{ proposerDiscordId: discordId }, { beneficiaryDiscordId: discordId }], amountUsdCents: { not: null } },
    orderBy: { closedAt: 'desc' },
    take: 50,
    select: { id: true, title: true, amountUsdCents: true },
  })
  return (rows as Array<{ id: string; title: string; amountUsdCents: number | null }>).map((r) => ({ id: r.id, title: r.title, amountUsd: (r.amountUsdCents ?? 0) / 100 }))
}

export { DRAFT_RETRY_MS }

export interface AdminProposalRow {
  id: string
  title: string
  kind: 'FUNDING' | 'GENERAL'
  status: ProposalSummary['status']
  isTest: boolean
  createdAt: string
  closesAt: string | null
  /** A draft that has waited past the stuck threshold. */
  stuck: boolean
  /** The code of the latest OPEN_FAILED event of a draft (never a message). */
  failureCode: string | null
}

/** The /admin/proposals list: waiting and open app proposals (test ones too), then the latest closed ones. */
export async function listForAdmin(now: Date = new Date(), stuckAfterMs = 2 * 60 * 60 * 1000): Promise<{ active: AdminProposalRow[]; recent: AdminProposalRow[] }> {
  const select = { id: true, title: true, kind: true, status: true, isTest: true, createdAt: true, closesAt: true } as const
  const [active, recent] = await Promise.all([
    prisma.proposal.findMany({ where: { source: 'APP', status: { in: ['DRAFT', 'OPEN'] } }, orderBy: { createdAt: 'asc' }, take: 200, select }),
    prisma.proposal.findMany({ where: { source: 'APP', status: { in: ['PASSED', 'FAILED', 'CANCELLED'] } }, orderBy: { updatedAt: 'desc' }, take: 20, select }),
  ])
  type Row = { id: string; title: string; kind: 'FUNDING' | 'GENERAL'; status: ProposalSummary['status']; isTest: boolean; createdAt: Date; closesAt: Date | null }
  const drafts = (active as Row[]).filter((r) => r.status === 'DRAFT').map((r) => r.id)
  const failures = drafts.length
    ? ((await prisma.proposalEvent.findMany({ where: { proposalId: { in: drafts }, type: 'OPEN_FAILED' }, orderBy: { createdAt: 'asc' }, select: { proposalId: true, data: true } })) as Array<{ proposalId: string; data: unknown }>)
    : []
  const lastCode = new Map<string, string>()
  for (const f of failures) {
    const code = (f.data as { code?: unknown } | null)?.code
    if (typeof code === 'string') lastCode.set(f.proposalId, code.slice(0, 40))
  }
  const row = (r: Row): AdminProposalRow => ({
    id: r.id,
    title: r.title,
    kind: r.kind,
    status: r.status,
    isTest: r.isTest,
    createdAt: r.createdAt.toISOString(),
    closesAt: r.closesAt?.toISOString() ?? null,
    stuck: r.status === 'DRAFT' && now.getTime() - r.createdAt.getTime() > stuckAfterMs,
    failureCode: r.status === 'DRAFT' ? (lastCode.get(r.id) ?? null) : null,
  })
  return { active: (active as Row[]).map(row), recent: (recent as Row[]).map(row) }
}
