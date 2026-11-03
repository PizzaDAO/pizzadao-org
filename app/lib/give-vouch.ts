/**
 * The one place the vouch rules live, shared by the website (POST /api/vouches/add, including the
 * members list's one-click button) and the Discord /vouch command:
 *
 *   - the voucher has a member profile
 *   - no vouching for yourself
 *   - the target is a member
 *   - at most `vouches.dailyLimit` vouches per rolling 24 hours
 *   - one vouch per pair (a repeat answers "already vouched")
 *   - then the mission events (L5.2 for the voucher, L4.2 for the vouched member) and the
 *     notification, scheduled through `defer` so they never delay the reply
 *
 * It does NOT apply the disavow warning: that is a client dialog on the website (warn, never block)
 * and a "vouch from their profile" answer in Discord (see discord-interactions/member-commands.ts).
 */
import { prisma } from '@/app/lib/db'
import { addVouch, notifyVouchAdded } from '@/app/lib/vouches'
import { fetchMemberById } from '@/app/lib/sheets/member-repository'
import { findMemberByDiscordId } from '@/app/lib/member-utils'
import { emitMissionEvent } from '@/app/lib/mission-verify/events'
import { getSetting } from '@/app/lib/settings'

export const DAY_MS = 24 * 60 * 60 * 1000

export type GiveVouchResult =
  | { ok: true; targetMemberId: string; targetName: string }
  | { ok: false; reason: 'no-profile' | 'self' | 'not-found' | 'duplicate' }
  | { ok: false; reason: 'limit'; limit: number }

export interface GiveVouchDeps {
  findVoucher: (discordId: string) => Promise<{ memberId: string; name: string } | null>
  fetchTarget: (memberId: string) => Promise<Record<string, unknown> | null>
  /** Vouches this member gave since `since`. */
  countRecent: (memberId: string, since: Date) => Promise<number>
  dailyLimit: () => Promise<number>
  create: (followerId: string, followeeId: string) => Promise<unknown>
  emit: (discordId: string, event: 'vouch_created' | 'vouch_received', memberId: string) => Promise<unknown>
  notify: (targetMemberId: string, voucherName: string, voucherMemberId: string, targetDiscordId: string) => Promise<unknown>
  now: () => Date
}

export const defaultGiveVouchDeps: GiveVouchDeps = {
  findVoucher: findMemberByDiscordId,
  fetchTarget: (id) => fetchMemberById(id) as Promise<Record<string, unknown> | null>,
  countRecent: (memberId, since) => prisma.vouch.count({ where: { followerId: memberId, createdAt: { gte: since } } }),
  dailyLimit: () => getSetting('vouches.dailyLimit'),
  create: (followerId, followeeId) => addVouch(followerId, followeeId),
  emit: (discordId, event, memberId) => emitMissionEvent(discordId, event, { memberId }),
  notify: notifyVouchAdded,
  now: () => new Date(),
}

const isUniqueViolation = (err: unknown) => typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002'

/**
 * Give a vouch from the member behind `voucherDiscordId` to `targetMemberId`.
 * `defer` schedules the after-work (route/interactions pass next/server's `after`); default runs it right away.
 */
export async function giveVouch(
  input: { voucherDiscordId: string; targetMemberId: string },
  opts: { defer?: (job: () => Promise<unknown>) => void; deps?: GiveVouchDeps } = {},
): Promise<GiveVouchResult> {
  const deps = opts.deps ?? defaultGiveVouchDeps
  const defer = opts.defer ?? ((job) => void job().catch(() => undefined))

  const voucher = await deps.findVoucher(input.voucherDiscordId)
  if (!voucher?.memberId) return { ok: false, reason: 'no-profile' }
  if (voucher.memberId === input.targetMemberId) return { ok: false, reason: 'self' }

  const target = await deps.fetchTarget(input.targetMemberId)
  if (!target) return { ok: false, reason: 'not-found' }

  const limit = await deps.dailyLimit()
  const recent = await deps.countRecent(voucher.memberId, new Date(deps.now().getTime() - DAY_MS))
  if (recent >= limit) return { ok: false, reason: 'limit', limit }

  try {
    await deps.create(voucher.memberId, input.targetMemberId)
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, reason: 'duplicate' }
    throw err
  }

  const targetDiscordId = String(target['discordId'] ?? '').trim()
  // L5.2 "Vouch for another member" for the voucher; L4.2 "Get vouched by a member" for the target.
  defer(() => deps.emit(input.voucherDiscordId, 'vouch_created', voucher.memberId))
  if (targetDiscordId) {
    defer(() => deps.emit(targetDiscordId, 'vouch_received', input.targetMemberId))
    defer(() => deps.notify(input.targetMemberId, voucher.name || 'Someone', voucher.memberId, targetDiscordId))
  }
  return { ok: true, targetMemberId: input.targetMemberId, targetName: String(target['Name'] ?? target['Mafia Name'] ?? '').trim() }
}
