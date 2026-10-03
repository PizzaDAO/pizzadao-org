/**
 * Referral capture for L3.1 "Invite a friend to Discord" (plans/mission-verification.md D4).
 *
 * Two ways in, one row per invitee (Referral.inviteeDiscordId is unique):
 *   - the "Who invited you?" onboarding step (optional member picker), and
 *   - personal invite links, /join?ref=<memberId>: the ref is kept in the
 *     httpOnly `pd_ref` cookie (POST /api/referrals/ref) across the Discord
 *     login and read when onboarding completes (POST /api/profile).
 *
 * The referral is recorded when the invitee completes onboarding, which is
 * also what qualifies it (D4), so qualifiedAt = now. Rules:
 *   - a self-referral (same Discord account or same member ID) is refused,
 *     nothing is written;
 *   - an inviter that isn't an onboarded member (no Discord id on the members
 *     sheet) is ignored;
 *   - a wallet / X / Telegram account the invitee shares with the inviter, or
 *     an AccountSignal (Phase 2) naming both, is stored in `flags`: recorded,
 *     not blocked, but the referral verifier doesn't count it (a reviewer can
 *     approve the mission by hand).
 * Never throws into the onboarding request.
 */
import { prisma } from './db'
import { fetchMemberById } from './sheets/member-repository'
import { normalizeRef } from './referral-link'

export type ReferralVia = 'onboarding' | 'invite_link'

export type ReferralOutcome =
  | 'recorded'
  | 'recorded_flagged'
  | 'no_ref'
  | 'self_referral'
  | 'unknown_inviter'
  | 'already_referred'
  | 'error'

export interface RecordReferralInput {
  inviteeDiscordId: string
  inviteeMemberId: string | null
  /** The inviter's member ID (from the picker or the invite link). */
  inviterMemberId: string | null | undefined
  via: ReferralVia
  /** The ?ref= value, when the invite link was used. */
  inviteCode?: string | null
  now?: Date
}

export interface ReferralDeps {
  /** The Discord id on the inviter's members-sheet row; null when not an onboarded member. */
  inviterDiscordId: (memberId: string) => Promise<string | null>
  /** Duplicate-account signal kinds between the two accounts (live check + stored AccountSignal rows). */
  sharedAccounts: (a: { discordId: string; memberId: string | null }, b: { discordId: string; memberId: string | null }) => Promise<string[]>
  create: (data: {
    inviteeDiscordId: string
    inviteeMemberId: string | null
    inviterDiscordId: string
    inviterMemberId: string
    via: ReferralVia
    inviteCode: string | null
    qualifiedAt: Date
    flags: string[]
  }) => Promise<'created' | 'exists'>
}

export interface RecordReferralResult {
  outcome: ReferralOutcome
  inviterDiscordId?: string
  flags?: string[]
}

export async function recordReferral(input: RecordReferralInput, deps: ReferralDeps = defaultReferralDeps): Promise<RecordReferralResult> {
  const inviterMemberId = normalizeRef(input.inviterMemberId)
  if (!inviterMemberId || !input.inviteeDiscordId) return { outcome: 'no_ref' }
  const inviteeMemberId = normalizeRef(input.inviteeMemberId)
  if (inviteeMemberId && inviteeMemberId === inviterMemberId) return { outcome: 'self_referral' }
  try {
    const inviterDiscordId = await deps.inviterDiscordId(inviterMemberId)
    if (!inviterDiscordId) return { outcome: 'unknown_inviter' }
    if (inviterDiscordId === input.inviteeDiscordId) return { outcome: 'self_referral', inviterDiscordId }

    const flags = await deps
      .sharedAccounts({ discordId: inviterDiscordId, memberId: inviterMemberId }, { discordId: input.inviteeDiscordId, memberId: inviteeMemberId })
      .catch(() => [] as string[])
    const created = await deps.create({
      inviteeDiscordId: input.inviteeDiscordId,
      inviteeMemberId,
      inviterDiscordId,
      inviterMemberId,
      via: input.via,
      inviteCode: input.via === 'invite_link' ? (normalizeRef(input.inviteCode) ?? inviterMemberId) : null,
      qualifiedAt: input.now ?? new Date(),
      flags,
    })
    if (created === 'exists') return { outcome: 'already_referred', inviterDiscordId }
    return { outcome: flags.length ? 'recorded_flagged' : 'recorded', inviterDiscordId, flags }
  } catch (e) {
    console.error('[referrals] recording failed:', e)
    return { outcome: 'error' }
  }
}

/**
 * Pick the inviter for a completed onboarding: an explicit choice in the
 * "Who invited you?" step wins (an empty choice = "no one", even with a
 * cookie); otherwise the invite-link cookie. Pure.
 */
export function chooseInviter(bodyChoice: unknown, cookieRef: string | null | undefined): { memberId: string | null; via: ReferralVia; inviteCode: string | null } {
  const cookie = normalizeRef(cookieRef)
  if (bodyChoice !== undefined && bodyChoice !== null) {
    const picked = normalizeRef(bodyChoice)
    if (!picked) return { memberId: null, via: 'onboarding', inviteCode: null }
    return picked === cookie ? { memberId: picked, via: 'invite_link', inviteCode: cookie } : { memberId: picked, via: 'onboarding', inviteCode: null }
  }
  return cookie ? { memberId: cookie, via: 'invite_link', inviteCode: cookie } : { memberId: null, via: 'onboarding', inviteCode: null }
}

const lower = (s: string | null | undefined) => (s ?? '').trim().replace(/^@/, '').toLowerCase()

export const defaultReferralDeps: ReferralDeps = {
  async inviterDiscordId(memberId) {
    const row = await fetchMemberById(memberId)
    const d = String(row?.discordId ?? '').trim()
    return /^\d{15,25}$/.test(d) ? d : null
  },

  async sharedAccounts(a, b) {
    const ids = [a.discordId, b.discordId]
    const members = [a.memberId, b.memberId].filter((m): m is string => !!m)
    const [wallets, xs, tgs, signals] = await Promise.all([
      prisma.memberWallet.findMany({
        where: { OR: [{ discordId: { in: ids } }, ...(members.length ? [{ memberId: { in: members } }] : [])] },
        select: { discordId: true, memberId: true, walletAddress: true },
      }),
      prisma.xAccount.findMany({ where: { discordId: { in: ids } }, select: { discordId: true, xUsername: true } }),
      prisma.telegramAccount.findMany({ where: { discordId: { in: ids } }, select: { discordId: true, username: true } }),
      prisma.accountSignal.findMany({ where: { discordIds: { hasEvery: ids } }, select: { kind: true } }).catch(() => []),
    ])
    const side = (r: { discordId: string | null; memberId?: string | null }) =>
      r.discordId === a.discordId || (!!a.memberId && r.memberId === a.memberId) ? 'a' : 'b'
    const flags = new Set<string>(signals.map((s) => s.kind))
    const addrs = { a: new Set<string>(), b: new Set<string>() }
    for (const w of wallets) addrs[side(w)].add(lower(w.walletAddress))
    if ([...addrs.a].some((x) => x && addrs.b.has(x))) flags.add('shared_wallet')
    const handle = (rows: Array<{ discordId: string; h: string | null }>, who: string) => lower(rows.find((r) => r.discordId === who)?.h)
    const xa = handle(xs.map((x) => ({ discordId: x.discordId, h: x.xUsername })), a.discordId)
    if (xa && xa === handle(xs.map((x) => ({ discordId: x.discordId, h: x.xUsername })), b.discordId)) flags.add('shared_x')
    const ta = handle(tgs.map((t) => ({ discordId: t.discordId, h: t.username })), a.discordId)
    if (ta && ta === handle(tgs.map((t) => ({ discordId: t.discordId, h: t.username })), b.discordId)) flags.add('shared_telegram')
    return [...flags].sort()
  },

  async create(data) {
    try {
      await prisma.referral.create({ data })
      return 'created'
    } catch (e) {
      if ((e as { code?: string })?.code === 'P2002') return 'exists'
      throw e
    }
  },
}
