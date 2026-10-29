/**
 * Metalhead's posts for proposals: one when a proposal opens (with the Vote link) and one at close (the result).
 * There is no voting in Discord (Discord would see choices): the post only links to the site.
 *
 * Each post is claimed first with a conditional update (so the create route and the daily cron can never post
 * twice) and un-claimed if Discord definitely did not post, so the next cron run retries. Best effort: a Discord
 * outage never blocks opening or closing a proposal. Counts appear only in the result post.
 */
import { prisma } from '@/app/lib/db'
import { DiscordPostError, postDiscordMessage, type DiscordMessageBody } from '@/app/lib/discord-rest'
import { getSetting } from '@/app/lib/settings'
import { resolveConfiguredChannel } from '@/app/lib/settings/channels'

export interface PostDeps {
  channelId(): Promise<string | null>
  pingRoleId(): Promise<string>
  post(channelId: string, body: DiscordMessageBody): Promise<{ id: string | null }>
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

/** True when Discord definitely did not create the message, so the claim can be released for a retry. */
function definitelyNotPosted(e: unknown): boolean {
  return e instanceof DiscordPostError && !e.cloudflare && e.status >= 400 && e.status < 500
}

export type PostOutcome = 'posted' | 'skipped' | 'failed'

export async function announceOpen(id: string, deps: PostDeps = defaultPostDeps): Promise<PostOutcome> {
  const channelId = await deps.channelId().catch(() => null)
  if (!channelId) return 'skipped'
  const claimed = await prisma.proposal.updateMany({ where: { id, status: 'OPEN', discordChannelId: null }, data: { discordChannelId: channelId } })
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
    select: { id: true, title: true, status: true, ayes: true, nays: true, abstains: true, ayesNeeded: true, discordChannelId: true },
  })
  if (!p || (p.status !== 'PASSED' && p.status !== 'FAILED')) return 'skipped'
  const channelId = p.discordChannelId || (await deps.channelId().catch(() => null))
  if (!channelId) return 'skipped'
  const claimed = await prisma.proposal.updateMany({ where: { id, resultPostedAt: null, status: { in: ['PASSED', 'FAILED'] } }, data: { resultPostedAt: now } })
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
