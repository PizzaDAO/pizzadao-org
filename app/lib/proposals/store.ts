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
import { COUNT_ABSTAINS, DAY_MS, DRAFT_RETRY_MS, REQUIRE_AYES_OVER_NAYS } from './constants'
import { defaultRoleDeps, snapshotRoleHolders, type RoleDeps } from './eligibility'
import { generateProposalKeyPair, wrapPrivateKey } from './keys'
import { ayesNeededFor, loadProposalRules, type ProposalRules } from './rules'
import { countBallots, tallyProposal } from './tally'
import { ballotKey, signBlinded, verifyBallotCredentials, type BallotCredentials } from './token'
import type { NewProposal } from './validate'

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]
export type Choice = 'AYE' | 'NAY' | 'ABSTAIN'
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

export async function createProposal(input: NewProposal & { proposerDiscordId: string }): Promise<{ id: string }> {
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
        countAbstains: COUNT_ABSTAINS,
        requireAyesOverNays: REQUIRE_AYES_OVER_NAYS,
      },
      select: { id: true },
    })
    await logEvent(tx, row.id, 'CREATED', input.proposerDiscordId, { kind: input.kind })
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
  | { ok: false; code: 'not_found' | 'not_draft' | 'not_production' }

/**
 * Open a DRAFT proposal: list the voter-role holders (strict: any Discord failure aborts), generate this proposal's
 * own signing key pair, copy the rules onto it and start the window. The slow parts run outside the transaction;
 * the transaction only lands if the proposal is still a DRAFT, so a second open attempt changes nothing.
 */
export async function openProposal(
  id: string,
  opts: { now?: Date; deps?: RoleDeps; rules?: ProposalRules; env?: NodeJS.ProcessEnv; keyBits?: number } = {},
): Promise<OpenResult> {
  const env = opts.env ?? process.env
  if (!isProduction(env)) return { ok: false, code: 'not_production' }
  const now = opts.now ?? new Date()
  const p = await prisma.proposal.findUnique({ where: { id }, select: { status: true, kind: true, amountUsdCents: true } })
  if (!p) return { ok: false, code: 'not_found' }
  if (p.status !== 'DRAFT') return { ok: false, code: 'not_draft' }
  const rules = opts.rules ?? (await loadProposalRules())
  const snap = await snapshotRoleHolders(opts.deps ?? defaultRoleDeps)
  const pair = await generateProposalKeyPair(opts.keyBits)
  const keyPrivateEnc = await wrapPrivateKey(pair.privatePem, id, env)
  const closesAt = new Date(now.getTime() + rules.windowDays * DAY_MS)
  const ayesNeeded = ayesNeededFor(p.kind, p.amountUsdCents, rules)
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
    await logEvent(tx, id, 'OPENED', null, { eligible: snap.discordIds.length, ayesNeeded, windowDays: rules.windowDays })
    return { ok: true as const, eligible: snap.discordIds.length }
  })
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

const MAX_BLOB = 6000

/**
 * Optional wallet-encrypted ballot backup. The server stores ciphertext only: the key is derived in the browser
 * from a wallet signature that never leaves it. Replaces any earlier backup.
 */
export async function saveBallotBlob(proposalId: string, discordId: string, blob: unknown): Promise<'ok' | 'not_eligible' | 'bad_request'> {
  if (typeof blob !== 'string' || blob.length < 20 || blob.length > MAX_BLOB || !/^[A-Za-z0-9+/_=-]+$/.test(blob)) return 'bad_request'
  const r = await prisma.proposalVoter.updateMany({ where: { proposalId, discordId }, data: { ballotBlob: blob } })
  return r.count === 1 ? 'ok' : 'not_eligible'
}

export async function getBallotBlob(proposalId: string, discordId: string): Promise<{ eligible: boolean; blob: string | null }> {
  const v = await prisma.proposalVoter.findUnique({ where: { proposalId_discordId: { proposalId, discordId } }, select: { ballotBlob: true } })
  return { eligible: !!v, blob: v?.ballotBlob ?? null }
}

// -------------------------------------------------------------------- vote

export type BallotResult =
  | { ok: true }
  | { ok: false; code: 'not_found' | 'closed' | 'bad_request' | 'invalid_token' | 'not_production' }

/**
 * Record (or replace) a ballot. No session, no member id: the signature on the token is the only credential.
 * The ballot is keyed by hash(proposalId + token), so the same token replaces the choice until the proposal closes.
 */
export async function castBallot(
  proposalId: string,
  creds: BallotCredentials,
  choice: unknown,
  opts: { now?: Date; env?: NodeJS.ProcessEnv } = {},
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

/** Count a proposal that is due. Idempotent: only an OPEN proposal past closesAt settles, once. */
export async function settleProposal(id: string, now: Date = new Date()): Promise<SettleResult> {
  return prisma.$transaction(async (tx) => {
    await lockProposal(tx, id)
    const p = await tx.proposal.findUnique({
      where: { id },
      select: { status: true, closesAt: true, ayesNeeded: true, countAbstains: true, requireAyesOverNays: true },
    })
    if (!p) return { ok: false as const, code: 'not_found' as const }
    if (p.status !== 'OPEN' || !p.closesAt || p.ayesNeeded == null) return { ok: false as const, code: 'not_open' as const }
    if (now < p.closesAt) return { ok: false as const, code: 'not_due' as const }
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
  })
}

// ------------------------------------------------------------------- reads

export interface ProposalSummary {
  id: string
  kind: 'FUNDING' | 'GENERAL'
  status: 'DRAFT' | 'OPEN' | 'PASSED' | 'FAILED' | 'CANCELLED'
  title: string
  amountUsd: number | null
  city: string | null
  opensAt: string | null
  closesAt: string | null
  /** Only for a settled proposal: counts stay hidden while voting is open. */
  result: { ayes: number; nays: number; abstains: number; ayesNeeded: number | null } | null
}

type ProposalRow = {
  id: string; kind: 'FUNDING' | 'GENERAL'; status: ProposalSummary['status']; title: string; amountUsdCents: number | null
  city: string | null; opensAt: Date | null; closesAt: Date | null; ayes: number; nays: number; abstains: number; ayesNeeded: number | null
}

const SUMMARY_SELECT = {
  id: true, kind: true, status: true, title: true, amountUsdCents: true, city: true, opensAt: true, closesAt: true,
  ayes: true, nays: true, abstains: true, ayesNeeded: true,
} as const

export function toSummary(r: ProposalRow): ProposalSummary {
  const settled = r.status === 'PASSED' || r.status === 'FAILED'
  return {
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
    prisma.proposal.findMany({ where: { status: { in: ['DRAFT', 'OPEN'] } }, orderBy: { createdAt: 'desc' }, take: 100, select: SUMMARY_SELECT }),
    prisma.proposal.findMany({ where: { status: { in: ['PASSED', 'FAILED'] } }, orderBy: { closedAt: 'desc' }, take: recentLimit, select: SUMMARY_SELECT }),
  ])
  return { open: (open as ProposalRow[]).map(toSummary), recent: (recent as ProposalRow[]).map(toSummary) }
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
}

export async function getProposalDetail(id: string, viewerDiscordId: string): Promise<ProposalDetail | null> {
  const r = await prisma.proposal.findUnique({
    where: { id },
    select: { ...SUMMARY_SELECT, body: true, eventDate: true, sponsorLabel: true, eligibleCount: true, proposerDiscordId: true, keyFingerprint: true },
  })
  if (!r) return null
  return {
    ...toSummary(r as ProposalRow),
    body: r.body,
    keyFingerprint: r.keyFingerprint,
    eventDate: r.eventDate ? r.eventDate.toISOString().slice(0, 10) : null,
    sponsorLabel: r.sponsorLabel,
    ayesNeeded: r.ayesNeeded,
    eligibleCount: r.eligibleCount,
    isProposer: r.proposerDiscordId === viewerDiscordId,
  }
}

/** Passed funding proposals the member filed, newest first: the ones a payment request can link to. */
export async function passedFundingProposalsFor(discordId: string): Promise<Array<{ id: string; title: string; amountUsd: number }>> {
  const rows = await prisma.proposal.findMany({
    where: { kind: 'FUNDING', status: 'PASSED', proposerDiscordId: discordId, amountUsdCents: { not: null } },
    orderBy: { closedAt: 'desc' },
    take: 50,
    select: { id: true, title: true, amountUsdCents: true },
  })
  return (rows as Array<{ id: string; title: string; amountUsdCents: number | null }>).map((r) => ({ id: r.id, title: r.title, amountUsd: (r.amountUsdCents ?? 0) / 100 }))
}

export { DRAFT_RETRY_MS }
