/**
 * The verifier registry (plans/mission-verification.md §2, §3.2).
 *
 * Mission.verifierKey picks one of these; Mission.verifierParams is parsed by
 * its `parse`. Phase 1 ships the automatic ones:
 *
 *   x_linked          L1.0  an OAuth-linked X account (the follow stays on the honor system, D1)
 *   attendance_count  L2.0 (min 1), L5.0 (min 3): calls attended, any crews, community calls count (D2, D3)
 *   discord_message   L3.0  the submitted message link is the member's own post in #show-and-tell
 *   referral          L3.1  a friend this member invited finished onboarding (Phase 4, D4)
 *   discord_role      L6.0  holds the Pepperoni Mafia role; L7.0 holds the "Crew Leader" role
 *                     (D12; MISSION_CREW_LEADER_ROLE overrides). L6+ always needs a human release (D9).
 *   vouch_given       L5.2  vouched for at least `min` OTHER members (PizzaDAO-native vouches by default)
 *   wallet_connected  catalog: at least one wallet linked
 *   manual            L8.0: never run, always a human (Dread Pizza Roberts)
 *
 * Phase 4 adds the semi-automatic ones (./semi.ts): social_post (L2.1),
 * poap_drop (L4.1), media_proof (L5.1), gpp_host (L6.1). They pre-check a
 * submitted proof for a reviewer and never approve on their own.
 */
import { asObject, positiveInt, stringList, type Verifier, type VerifyCtx, type VerifyResult } from './types'
import { parseMessageLink } from '../discord-channels'
import { inviteUrl } from '../referral-link'
import { SEMI_VERIFIERS } from './semi'

const fail = (reason: string, hint?: string, progress?: { have: number; need: number }): VerifyResult => ({
  status: 'fail',
  reason,
  ...(hint ? { hint } : {}),
  ...(progress ? { progress } : {}),
})

export const xLinked: Verifier<Record<string, never>> = {
  key: 'x_linked',
  mode: 'auto',
  stateful: false,
  parse: (p) => {
    asObject(p)
    return {}
  },
  async check(ctx) {
    const x = await ctx.sources.getXAccount(ctx.discordId)
    if (!x) return fail('No X account linked', 'Link your X account on your profile page (Connect X).')
    return { status: 'pass', evidence: { xUsername: x.xUsername } }
  },
}

export const attendanceCount: Verifier<{ min: number }> = {
  key: 'attendance_count',
  mode: 'auto',
  stateful: false,
  parse: (p) => {
    const o = asObject(p)
    // crews: "any" and distinct: "call" are the only modes (D2, D3); anything else is a config error.
    if (o.crews !== undefined && o.crews !== 'any') throw new Error('crews must be "any"')
    if (o.distinct !== undefined && o.distinct !== 'call') throw new Error('distinct must be "call"')
    return { min: positiveInt(o.min, 'min', 1) }
  },
  async check(ctx, { min }) {
    const { total, byCrew } = await ctx.sources.countCallsAttended(ctx.discordId)
    if (total >= min) return { status: 'pass', evidence: { calls: total, need: min, byCrew } }
    const need = min === 1 ? 'Join a community call or any crew call' : `Join ${min - total} more call${min - total === 1 ? '' : 's'} (community or any crew)`
    return fail(
      `${total}/${min} calls attended`,
      `${need}. Attendance is synced from the call sheets, so it can take a day to show up.`,
      { have: total, need: min },
    )
  },
}

type RoleParams = { roleIds: string[]; roleNames: string[]; roleEnv?: string }

/**
 * Holds any of the given roles. Roles are pinned ids (`roleIds`, L6.0
 * Pepperoni Mafia) and/or names (`roleNames`, L7.0 "Crew Leader") resolved
 * against the cached guild role list. `roleEnv` names an env var that, when
 * set, replaces the configured roles: a role id, or a role name.
 */
export const discordRole: Verifier<RoleParams> = {
  key: 'discord_role',
  mode: 'auto',
  stateful: true,
  parse: (p) => {
    const o = asObject(p)
    const roleIds = o.roleIds === undefined ? [] : stringList(o.roleIds, 'roleIds')
    const roleNames = o.roleNames === undefined ? [] : stringList(o.roleNames, 'roleNames')
    if (roleIds.some((id) => !/^\d{5,25}$/.test(id))) throw new Error('roleIds must be snowflakes')
    if (!roleIds.length && !roleNames.length) throw new Error('roleIds or roleNames is required')
    const roleEnv = typeof o.roleEnv === 'string' && o.roleEnv.trim() ? o.roleEnv.trim() : undefined
    return { roleIds, roleNames, ...(roleEnv ? { roleEnv } : {}) }
  },
  async check(ctx, params) {
    let { roleIds, roleNames } = params
    const override = params.roleEnv ? process.env[params.roleEnv]?.trim() : ''
    if (override) {
      if (/^\d{5,25}$/.test(override)) [roleIds, roleNames] = [[override], []]
      else [roleIds, roleNames] = [[], [override]]
    }
    let wanted = roleIds
    if (roleNames.length) {
      const resolved = await ctx.sources.resolveRoleIds(roleNames)
      if (resolved === null && !roleIds.length) return { status: 'unknown', reason: "Couldn't read the server's roles right now" }
      wanted = [...roleIds, ...(resolved ?? [])]
      if (!wanted.length) return { status: 'unknown', reason: `No role named ${roleNames.map((n) => `"${n}"`).join(' or ')} in the server` }
    }
    const roles = ctx.interactionRoles ?? (await memberRoles(ctx))
    if (roles === null) return { status: 'unknown', reason: "Couldn't read your Discord roles right now" }
    const held = roles.filter((r) => wanted.includes(r))
    if (held.length) return { status: 'pass', evidence: { roleIds: held } }
    const name = roleNames.length ? ` (${roleNames.join(' / ')})` : ''
    return fail(`Required Discord role not held${name}`, 'This role is granted by the crew. Keep showing up!')
  },
}

type MessageParams = { channelName: string; channelEnv: string; channelId?: string }

export const discordMessage: Verifier<MessageParams> = {
  key: 'discord_message',
  mode: 'auto',
  stateful: false,
  parse: (p) => {
    const o = asObject(p)
    const channelName = o.channelName === undefined ? 'show-and-tell' : String(o.channelName).trim()
    const channelEnv = o.channelEnv === undefined ? 'SHOW_AND_TELL_CHANNEL_ID' : String(o.channelEnv).trim()
    if (!channelName) throw new Error('channelName must be a channel name')
    const channelId = o.channelId === undefined ? undefined : String(o.channelId)
    if (channelId !== undefined && !/^\d{5,25}$/.test(channelId)) throw new Error('channelId must be a snowflake')
    return { channelName, channelEnv, ...(channelId ? { channelId } : {}) }
  },
  async check(ctx, { channelName, channelEnv, channelId }) {
    const hint = `Post in #${channelName}, then submit the message link (right-click the message, Copy Message Link).`
    const link = parseMessageLink(ctx.evidence)
    if (!link) return fail(`No #${channelName} message link submitted`, hint)
    const guildId = ctx.sources.guildId()
    if (guildId && link.guildId !== guildId) return fail('That link is not from the PizzaDAO server', hint)

    const target = channelId ?? (await ctx.sources.resolveChannelId(channelName, channelEnv))
    if (!target) return { status: 'unknown', reason: `Couldn't find #${channelName}` }

    const msg = await ctx.sources.getChannelMessage(link.channelId, link.messageId)
    if (msg === 'unknown') return { status: 'unknown', reason: "Couldn't reach Discord to check the message" }
    if (!msg) return fail("That message doesn't exist (or the bot can't see it)", hint)
    if (msg.authorId !== ctx.discordId) return fail('That message was posted by someone else', hint)

    if (msg.channelId !== target) {
      // A thread (or forum post) inside the channel counts too.
      const ch = await ctx.sources.getChannel(msg.channelId)
      if (ch === 'unknown') return { status: 'unknown', reason: "Couldn't reach Discord to check the channel" }
      if (!ch || ch.parentId !== target) return fail(`That message isn't in #${channelName}`, hint)
    }
    return { status: 'pass', evidence: { channelId: msg.channelId, messageId: link.messageId } }
  },
}

/**
 * L3.1 "Invite a friend" (D4). Passes once `min` people this member invited
 * (Referral rows: the invitee picked them in the "Who invited you?" step, or
 * joined through their /join?ref= link) have finished onboarding.
 *
 * Never counted: a self-referral (also refused at capture), and a referral
 * whose invitee shares a wallet / X / Telegram / member ID with the inviter
 * (the flags stored at capture, plus the nightly AccountSignal rows). Those
 * are "flags, not blocks" (D4, §6.2): the member can still submit the mission
 * and a reviewer approves it by hand, with a note (also the path for invites
 * from before tracking existed).
 */
export const referral: Verifier<{ min: number }> = {
  key: 'referral',
  mode: 'auto',
  stateful: false,
  parse: (p) => {
    const o = asObject(p)
    if (o.qualify !== undefined && o.qualify !== 'onboarded') throw new Error('qualify must be "onboarded"')
    return { min: positiveInt(o.min, 'min', 1) }
  },
  async check(ctx, { min }) {
    const rows = await ctx.sources.getReferrals(ctx.discordId)
    const qualified = rows.filter((r) => r.qualifiedAt && r.inviteeDiscordId !== ctx.discordId)
    const clean: string[] = []
    const flagged: Array<{ invitee: string; flags: string[] }> = []
    for (const r of qualified) {
      const flags = [...new Set([...r.flags, ...(await ctx.sources.sharedSignalKinds(ctx.discordId, r.inviteeDiscordId))])]
      if (flags.length) flagged.push({ invitee: r.inviteeDiscordId, flags })
      else clean.push(r.inviteeDiscordId)
    }
    if (clean.length >= min) {
      return { status: 'pass', evidence: { referrals: clean.length, invitees: clean.slice(0, 5), ...(flagged.length ? { flagged: flagged.length } : {}) } }
    }
    const link = ctx.memberId ? inviteUrl(ctx.memberId) : null
    const share = link ? `Share your invite link ${link}` : 'Finish onboarding to get your invite link'
    if (flagged.length) {
      return fail(
        `${flagged.length} invite${flagged.length === 1 ? '' : 's'} shares a wallet, X or Telegram account with you`,
        'Submit this mission for review: a reviewer can approve it.',
        { have: clean.length, need: min },
      )
    }
    return fail(
      `${clean.length}/${min} invited friends finished onboarding`,
      `${share}, or ask your friend to pick you in "Who invited you?" when they join. Invited someone before? Submit this mission for review and say who.`,
      { have: clean.length, need: min },
    )
  },
}

const VOUCH_SOURCES = ['PIZZADAO', 'TWITTER', 'FARCASTER'] as const

/**
 * L5.2 "Vouch for another member". Passes once the member has vouched for at
 * least `min` other members (Vouch rows, keyed by member ID).
 *
 * Self-vouches never count (the add route refuses them; this re-checks).
 * `sources` defaults to PIZZADAO only: FARCASTER / TWITTER rows are follows
 * imported from another network, not a deliberate vouch made in PizzaDAO, so
 * they don't show the member engaging with the community.
 */
export const vouchGiven: Verifier<{ min: number; sources: string[] }> = {
  key: 'vouch_given',
  mode: 'auto',
  stateful: false,
  parse: (p) => {
    const o = asObject(p)
    const sources = o.sources === undefined ? ['PIZZADAO'] : stringList(o.sources, 'sources').map((s) => s.toUpperCase())
    const bad = sources.filter((s) => !(VOUCH_SOURCES as readonly string[]).includes(s))
    if (bad.length) throw new Error(`sources must be from ${VOUCH_SOURCES.join(', ')}`)
    return { min: positiveInt(o.min, 'min', 1), sources }
  },
  async check(ctx, { min, sources }) {
    const hint = (left: number) =>
      `Vouch for ${left === 1 ? 'another member' : `${left} more members`}: open their profile and tap Vouch. Your vouches are listed on /vouches.`
    if (!ctx.memberId) return fail('No PizzaDAO member profile yet', 'Finish onboarding first, then vouch for another member.', { have: 0, need: min })
    const rows = await ctx.sources.getVouchesGiven(ctx.memberId)
    const counted = [
      ...new Set(rows.filter((r) => r.followeeId && r.followeeId !== ctx.memberId && sources.includes(r.source)).map((r) => r.followeeId)),
    ]
    if (counted.length >= min) return { status: 'pass', evidence: { vouches: counted.length, need: min, members: counted.slice(0, 5) } }
    return fail(`${counted.length}/${min} members vouched for`, hint(min - counted.length), { have: counted.length, need: min })
  },
}

export const walletConnected: Verifier<{ min: number }> = {
  key: 'wallet_connected',
  mode: 'auto',
  stateful: true,
  parse: (p) => ({ min: positiveInt(asObject(p).min, 'min', 1) }),
  async check(ctx, { min }) {
    const n = await ctx.sources.countWallets(ctx.discordId, ctx.memberId)
    if (n >= min) return { status: 'pass', evidence: { wallets: n } }
    return fail('No wallet connected', 'Connect a wallet on your profile page.', { have: n, need: min })
  },
}

export const manual: Verifier<Record<string, never>> = {
  key: 'manual',
  mode: 'manual',
  stateful: false,
  parse: () => ({}),
  async check() {
    return fail('Reviewed by a human', 'Submit this mission for review.')
  },
}

async function memberRoles(ctx: VerifyCtx): Promise<string[] | null> {
  if (ctx.memo.has('roles')) return ctx.memo.get('roles') as string[] | null
  const roles = await ctx.sources.getMemberRoles(ctx.discordId)
  ctx.memo.set('roles', roles)
  return roles
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const VERIFIERS: Record<string, Verifier<any>> = Object.fromEntries(
  [xLinked, attendanceCount, discordRole, discordMessage, referral, vouchGiven, walletConnected, manual, ...SEMI_VERIFIERS].map((v) => [v.key, v]),
)

export function getVerifier(key: string | null | undefined): Verifier<unknown> | null {
  return key ? (VERIFIERS[key] ?? null) : null
}
