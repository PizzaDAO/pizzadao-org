/**
 * /bounty list | claim | mine | giveup: the deferred half. The interaction handler answers within
 * Discord's 3 s window with a deferred EPHEMERAL reply (type 5, flags 64); this runs afterwards
 * (route: after()) and edits the reply in via the interaction webhook:
 *
 *   PATCH /webhooks/{application_id}/{token}/messages/@original
 *
 * Discord is only a front door: listing and claiming call the same app/lib/bounties.ts functions as
 * the website, so the rules, the escrow and the notifications stay the same. Submitting work and the
 * payout stay on the website, and replies link there. Dependencies are injected so tests never reach
 * Discord or the database. See plans/discord-bounty-command.md.
 */
import { ApiError } from '@/app/lib/errors/api-errors'
import { makeEmbed, type Embed, type EmbedAuthor } from './embeds'

const API = 'https://discord.com/api/v10'

export const BOUNTY_SUBCOMMANDS = ['list', 'claim', 'mine', 'giveup'] as const
export type BountySub = (typeof BOUNTY_SUBCOMMANDS)[number]

/** The bounty columns the replies need. */
export interface BountyRow {
  id: number
  description: string
  reward: number
  crewId: string | null
  status?: string
}

export interface BountyJob {
  sub: BountySub
  /** Who ran it; bounties store Discord ids, so this goes straight into claimBounty / giveUpBounty. */
  discordId: string
  /** The `crew` option of `list`, if given. */
  crewId?: string
  /** The `bounty` option of `claim` / `giveup`. */
  bountyId?: number
  applicationId: string
  token: string
  author?: EmbedAuthor
}

export interface BountyDeps {
  openBounties: (crewId?: string) => Promise<BountyRow[]>
  claimedBy: (discordId: string) => Promise<BountyRow[]>
  claim: (discordId: string, bountyId: number) => Promise<BountyRow>
  giveUp: (discordId: string, bountyId: number) => Promise<unknown>
  isMember: (discordId: string) => Promise<boolean>
  /** Crew id to display label. */
  crewLabels: () => Promise<Map<string, string>>
  appUrl: string
  fetchImpl?: typeof fetch
}

/** Most bounties one /bounty list reply shows. */
export const LIST_CAP = 10
const DESCRIPTION_CHARS = 90
const BODY_LIMIT = 4000

/** Markdown/mention-safe text for a reply. */
const esc = (s: string) => s.replace(/([*_`~|>\\[\]])/g, '\\$1').replace(/@/g, '@\u200b')
const link = (label: string, url: string) => `[${label}](<${url}>)`
const n = (v: number) => v.toLocaleString('en-US')

/** One line of text: newlines flattened, cut to about 90 characters, then escaped. */
function short(description: string): string {
  const flat = description.replace(/\s+/g, ' ').trim()
  // Cut by code points, so an emoji is never split in half.
  const chars = Array.from(flat)
  return esc(chars.length > DESCRIPTION_CHARS ? `${chars.slice(0, DESCRIPTION_CHARS - 1).join('').trimEnd()}…` : flat)
}

/** Where a bounty lives on the site: the crew's bounty board, or /pep for a general one. */
export const boardUrl = (appUrl: string, crewId?: string | null) =>
  crewId ? `${appUrl}/crew/${encodeURIComponent(crewId)}#bounties` : `${appUrl}/pep`

const crewName = (labels: Map<string, string>, crewId: string | null) => (crewId ? esc(labels.get(crewId) ?? crewId) : 'General')

/** `#id · 1,234 $PEP · Crew · description` */
export function bountyLine(b: BountyRow, labels: Map<string, string>): string {
  return `#${b.id} · ${n(b.reward)} $PEP · ${crewName(labels, b.crewId)} · ${short(b.description)}`
}

export function renderEmpty(appUrl: string, crewId?: string, labels: Map<string, string> = new Map(), author?: EmbedAuthor): Embed {
  const where = crewId ? ` for ${crewName(labels, crewId)}` : ''
  return makeEmbed(
    'success',
    `No open bounties right now${where}.`,
    `Have work that needs doing? Post a bounty with an escrowed $PEP reward: ${link(crewId ? 'Open the crew page' : 'Open the board', boardUrl(appUrl, crewId))}`,
    { author },
  )
}

/** Open bounties, newest first (the caller passes them in that order): up to LIST_CAP, then "N more". */
export function renderList(rows: BountyRow[], appUrl: string, labels: Map<string, string>, crewId?: string, author?: EmbedAuthor): Embed {
  if (rows.length === 0) return renderEmpty(appUrl, crewId, labels, author)
  const shown = rows.slice(0, LIST_CAP)
  const more = rows.length - shown.length
  const board = link(more > 0 ? `${more} more on the website` : 'Open the board', boardUrl(appUrl, crewId))
  const foot = `\n\nClaim one with \`/bounty claim\`. ${board}\nCrew tasks (no $PEP): see your crew page.`
  let body = shown.map((b) => bountyLine(b, labels)).join('\n')
  if (body.length > BODY_LIMIT - foot.length) body = body.slice(0, BODY_LIMIT - foot.length - 1) + '…'
  const head = `${rows.length} open bount${rows.length === 1 ? 'y' : 'ies'}${crewId ? ` for ${crewName(labels, crewId)}` : ''}`
  return makeEmbed('success', head, body + foot, { author })
}

export function renderClaimed(b: BountyRow, appUrl: string, author?: EmbedAuthor): Embed {
  return makeEmbed(
    'success',
    `You claimed #${b.id} (${n(b.reward)} $PEP).`,
    `When it's done, submit your work on the website; the poster or a crew lead approves it and the $PEP is paid to you.\n\n${link('Open the bounty board', boardUrl(appUrl, b.crewId))}`,
    { author },
  )
}

export function renderMine(rows: BountyRow[], appUrl: string, labels: Map<string, string>, author?: EmbedAuthor): Embed {
  if (rows.length === 0) {
    return makeEmbed('success', "You haven't claimed any bounties.", `Browse them with \`/bounty list\`. ${link('Open the board', `${appUrl}/pep`)}`, { author })
  }
  const shown = rows.slice(0, LIST_CAP)
  const more = rows.length - shown.length
  const body = shown.map((b) => `${bountyLine(b, labels)} · ${b.status === 'SUBMITTED' ? 'submitted, waiting for review' : 'claimed'}`).join('\n')
  const foot = `\n\nSubmit work on the website. ${link(more > 0 ? `${more} more on the website` : 'Open the board', `${appUrl}/pep`)}`
  return makeEmbed('success', `Your bounties (${rows.length})`, body.slice(0, BODY_LIMIT - foot.length) + foot, { author })
}

export function renderGaveUp(bountyId: number, author?: EmbedAuthor): Embed {
  return makeEmbed('success', `You gave up #${bountyId}.`, 'It is open for anyone to claim again.', { author })
}

/** Friendlier wording for the errors claimBounty / giveUpBounty throw (the rest are shown as they are). */
function friendly(message: string): string {
  return message === 'Bounty is not available' ? 'Someone else claimed it, or it was closed.' : message
}

/** Build the reply for a job. Pure apart from the injected deps. */
export async function buildBountyReply(job: BountyJob, deps: BountyDeps): Promise<Embed> {
  const { author } = job
  if (!(await deps.isMember(job.discordId))) {
    return makeEmbed('error', 'Finish onboarding first.', `Join PizzaDAO at ${link(deps.appUrl.replace(/^https?:\/\//, ''), deps.appUrl)}, then you can use bounties.`, { author })
  }

  switch (job.sub) {
    case 'list': {
      const [rows, labels] = await Promise.all([deps.openBounties(job.crewId), deps.crewLabels()])
      return renderList(rows, deps.appUrl, labels, job.crewId, author)
    }
    case 'mine': {
      const [rows, labels] = await Promise.all([deps.claimedBy(job.discordId), deps.crewLabels()])
      return renderMine(rows, deps.appUrl, labels, author)
    }
    case 'claim': {
      if (!job.bountyId) return makeEmbed('error', 'Pick a bounty to claim.', undefined, { author })
      try {
        return renderClaimed(await deps.claim(job.discordId, job.bountyId), deps.appUrl, author)
      } catch (err) {
        if (err instanceof ApiError && err.statusCode < 500) return makeEmbed('error', friendly(err.message), undefined, { author })
        throw err
      }
    }
    case 'giveup': {
      if (!job.bountyId) return makeEmbed('error', 'Pick a bounty to give up.', undefined, { author })
      try {
        await deps.giveUp(job.discordId, job.bountyId)
        return renderGaveUp(job.bountyId, author)
      } catch (err) {
        if (err instanceof ApiError && err.statusCode < 500) return makeEmbed('error', friendly(err.message), undefined, { author })
        throw err
      }
    }
  }
}

async function editOriginal(job: BountyJob, embed: Embed, fetchImpl: typeof fetch): Promise<void> {
  const res = await fetchImpl(`${API}/webhooks/${encodeURIComponent(job.applicationId)}/${encodeURIComponent(job.token)}/messages/@original`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed], allowed_mentions: { parse: [] } }),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Discord ${res.status} editing the /bounty reply`)
}

/** Build the reply and edit the deferred message. Never throws. */
export async function runBountyCommand(job: BountyJob, deps: BountyDeps): Promise<void> {
  const fetchImpl = deps.fetchImpl ?? fetch
  try {
    await editOriginal(job, await buildBountyReply(job, deps), fetchImpl)
  } catch (err) {
    console.error(`[/bounty ${job.sub}] failed:`, err instanceof Error ? err.message : String(err))
    try {
      await editOriginal(job, makeEmbed('error', 'Something went wrong. Please try again.', undefined, { author: job.author }), fetchImpl)
    } catch {
      // the token may have expired; nothing more to do
    }
  }
}
