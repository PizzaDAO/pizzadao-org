/**
 * Metalhead's posts for proposals: one when a proposal opens (with the Vote link) and one at close (the result).
 * There is no voting in Discord (Discord would see choices): the post only links to the site.
 *
 * Each post is claimed first with a conditional update (so the create route and the hourly cron can never post
 * twice) and un-claimed if Discord definitely did not post, so the next cron run retries. Best effort: a Discord
 * outage never blocks opening or closing a proposal. Counts appear only in the result post.
 */
import { prisma } from '@/app/lib/db'
import { DiscordPostError, editDiscordMessage, postDiscordMessage, type DiscordMessageBody } from '@/app/lib/discord-rest'
import { getSetting } from '@/app/lib/settings'
import { resolveConfiguredChannel, savedChannelId } from '@/app/lib/settings/channels'

export interface PostDeps {
  channelId(): Promise<string | null>
  pingRoleId(): Promise<string>
  post(channelId: string, body: DiscordMessageBody): Promise<{ id: string | null }>
  /** Edit a message the bot posted (the "withdrawn" update). */
  edit?(channelId: string, messageId: string, body: Partial<DiscordMessageBody>): Promise<void>
  /** The ops channel for stuck-proposal alerts; empty when none is set (the admin page still lists them). */
  opsChannelId?(): Promise<string | null>
  appUrl(): string
}

export const defaultPostDeps: PostDeps = {
  channelId: () => resolveConfiguredChannel('discord.proposalsChannelId', 'proposals', 'PROPOSALS_CHANNEL_ID'),
  pingRoleId: async () => {
    try {
      return await getSetting('discord.proposalsPingRoleId')
    } catch {
      return ''
    }
  },
  post: (channelId, body) => postDiscordMessage({ kind: 'bot', channelId, botToken: process.env.DISCORD_BOT_TOKEN?.trim() ?? '' }, body),
  edit: (channelId, messageId, body) => editDiscordMessage({ channelId, messageId, botToken: process.env.DISCORD_BOT_TOKEN?.trim() ?? '' }, body),
  opsChannelId: async () => (await savedChannelId('discord.proposalsOpsChannelId')) || null,
  appUrl: () => (process.env.NEXT_PUBLIC_APP_URL?.trim() || 'https://app.pizzadao.org').replace(/\/$/, ''),
}

const usd = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** The Discord post for a newly opened proposal. Pure. */
export function openMessage(
  p: { id: string; title: string; kind: 'FUNDING' | 'GENERAL'; amountUsdCents: number | null; closesAt: Date; ayesNeeded: number | null; keyFingerprint?: string | null },
  url: string,
  pingRoleId: string,
): DiscordMessageBody {
  const lines = [
    `${pingRoleId ? `<@&${pingRoleId}> ` : ''}**New proposal:** ${clip(p.title, 150)}`,
    p.kind === 'FUNDING' && p.amountUsdCents != null ? `Asking for ${usd(p.amountUsdCents)}.` : null,
    p.ayesNeeded != null ? `Needs ${p.ayesNeeded} ayes plus abstains, and more ayes than nays.` : null,
    `Voting closes <t:${Math.floor(p.closesAt.getTime() / 1000)}:F>. Votes are secret and you can change yours until then.`,
    // The link carries the key fingerprint, so a member who opens it from Discord has the browser check the key against it.
    `Vote: ${url}/proposals/${p.id}${p.keyFingerprint ? `?fp=${p.keyFingerprint.replace(/\s+/g, '')}` : ''}`,
    p.keyFingerprint ? `Voting key fingerprint (check it matches the proposal page): ${p.keyFingerprint}` : null,
  ]
  return {
    content: lines.filter(Boolean).join('\n'),
    allowed_mentions: { parse: [], ...(pingRoleId ? { roles: [pingRoleId] } : {}) },
  }
}

/** The result post. Pure. */
export function resultMessage(
  p: { id: string; title: string; status: 'PASSED' | 'FAILED'; ayes: number; nays: number; abstains: number; ayesNeeded: number | null },
  url: string,
): DiscordMessageBody {
  const verdict = p.status === 'PASSED' ? 'passed' : 'did not pass'
  return {
    content: [
      `**Proposal ${verdict}:** ${clip(p.title, 150)}`,
      `${p.ayes} aye, ${p.nays} nay, ${p.abstains} abstain${p.ayesNeeded != null ? ` (needed ${p.ayesNeeded} ayes plus abstains, and more ayes than nays)` : ''}.`,
      `${url}/proposals/${p.id}`,
    ].join('\n'),
    allowed_mentions: { parse: [] },
  }
}

/** What an open post becomes when the proposal is withdrawn or cancelled: no link, no ping, no reason. Pure. */
export function cancelledMessage(p: { title: string }): Partial<DiscordMessageBody> {
  return {
    content: `**Proposal withdrawn:** ${clip(p.title, 150)}\nVoting on it has ended and no votes were counted.`,
    allowed_mentions: { parse: [] },
  }
}

/** The ops alert for drafts that never opened. Counts only: no titles, no names. Pure. */
export function stuckMessage(count: number, url: string): DiscordMessageBody {
  return {
    content: `${count} proposal${count === 1 ? ' has' : 's have'} been waiting more than 2 hours to open for voting. Check ${url}/admin/proposals (the latest failure code is shown there).`,
    allowed_mentions: { parse: [] },
  }
}

/** True when Discord definitely did not create the message, so the claim can be released for a retry. */
function definitelyNotPosted(e: unknown): boolean {
  return e instanceof DiscordPostError && !e.cloudflare && e.status >= 400 && e.status < 500
}

export type PostOutcome = 'posted' | 'skipped' | 'failed'

export async function announceOpen(id: string, deps: PostDeps = defaultPostDeps): Promise<PostOutcome> {
  const channelId = await deps.channelId().catch(() => null)
  if (!channelId) return 'skipped'
  const claimed = await prisma.proposal.updateMany({ where: { id, source: 'APP', status: 'OPEN', discordChannelId: null }, data: { discordChannelId: channelId } })
  if (claimed.count !== 1) return 'skipped'
  const p = await prisma.proposal.findUnique({ where: { id }, select: { id: true, title: true, kind: true, amountUsdCents: true, closesAt: true, ayesNeeded: true, keyFingerprint: true } })
  if (!p?.closesAt) {
    await prisma.proposal.updateMany({ where: { id }, data: { discordChannelId: null } })
    return 'skipped'
  }
  try {
    const { id: messageId } = await deps.post(channelId, openMessage({ ...p, closesAt: p.closesAt }, deps.appUrl(), await deps.pingRoleId()))
    await prisma.proposal.update({ where: { id }, data: { discordMessageId: messageId } }).catch(() => {})
    return 'posted'
  } catch (e) {
    console.error('[proposals] open post failed:', (e as Error)?.name)
    if (definitelyNotPosted(e)) await prisma.proposal.updateMany({ where: { id }, data: { discordChannelId: null } })
    return 'failed'
  }
}

export async function announceResult(id: string, now: Date = new Date(), deps: PostDeps = defaultPostDeps): Promise<PostOutcome> {
  const p = await prisma.proposal.findUnique({
    where: { id },
    select: { id: true, title: true, status: true, source: true, ayes: true, nays: true, abstains: true, ayesNeeded: true, discordChannelId: true },
  })
  if (!p || p.source !== 'APP' || (p.status !== 'PASSED' && p.status !== 'FAILED')) return 'skipped'
  const channelId = p.discordChannelId || (await deps.channelId().catch(() => null))
  if (!channelId) return 'skipped'
  const claimed = await prisma.proposal.updateMany({ where: { id, source: 'APP', resultPostedAt: null, status: { in: ['PASSED', 'FAILED'] } }, data: { resultPostedAt: now } })
  if (claimed.count !== 1) return 'skipped'
  try {
    await deps.post(channelId, resultMessage({ ...p, status: p.status }, deps.appUrl()))
    return 'posted'
  } catch (e) {
    console.error('[proposals] result post failed:', (e as Error)?.name)
    if (definitelyNotPosted(e)) await prisma.proposal.updateMany({ where: { id }, data: { resultPostedAt: null } })
    return 'failed'
  }
}

/** Update the open post of a cancelled proposal in place (best effort: the cancel itself already happened). */
export async function announceCancelled(id: string, deps: PostDeps = defaultPostDeps): Promise<PostOutcome> {
  if (!deps.edit) return 'skipped'
  const p = await prisma.proposal.findUnique({ where: { id }, select: { title: true, status: true, discordChannelId: true, discordMessageId: true } })
  if (!p || p.status !== 'CANCELLED' || !p.discordChannelId || !p.discordMessageId) return 'skipped'
  try {
    await deps.edit(p.discordChannelId, p.discordMessageId, cancelledMessage(p))
    return 'posted'
  } catch (e) {
    console.error('[proposals] cancel post failed:', (e as Error)?.name)
    return 'failed'
  }
}

/** One short alert to the ops channel. Returns false when there is no channel or the post failed. */
export async function alertStuck(count: number, deps: PostDeps = defaultPostDeps): Promise<boolean> {
  const channelId = await deps.opsChannelId?.().catch(() => null)
  if (!channelId) return false
  try {
    await deps.post(channelId, stuckMessage(count, deps.appUrl()))
    return true
  } catch (e) {
    console.error('[proposals] stuck alert failed:', (e as Error)?.name)
    return false
  }
}
