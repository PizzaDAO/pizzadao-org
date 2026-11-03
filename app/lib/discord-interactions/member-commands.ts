/**
 * /vouch, /level and /profile: the deferred half. The interaction handler answers within Discord's
 * 3 s window with a deferred EPHEMERAL reply (type 5, flags 64); this runs afterwards (route:
 * after()) and edits the reply in via the interaction webhook:
 *
 *   PATCH /webhooks/{application_id}/{token}/messages/@original
 *
 * Every reply is private to the person who ran the command. Dependencies are injected so tests
 * never reach Discord or the database.
 *
 * Disavow: replies never reveal whether anyone is on the disavow list. A viewer who could see the
 * warning on the website (the same eligibility) is told only "please vouch from their profile",
 * with the profile link, where the website shows the warning.
 */
import { makeEmbed, type Embed, type EmbedAuthor } from './embeds'
import type { GiveVouchResult } from '@/app/lib/give-vouch'
import type { LevelInfo } from '@/app/lib/level-info'
import type { ProfileStats } from '@/app/lib/profile-stats'

const API = 'https://discord.com/api/v10'

export type MemberCommandName = 'vouch' | 'level' | 'profile'

export interface MemberCommandJob {
  name: MemberCommandName
  /** Who ran it. */
  discordId: string
  /** The `member` option, if given. */
  targetDiscordId?: string
  applicationId: string
  token: string
  author?: EmbedAuthor
}

export interface MemberCommandDeps {
  memberByDiscordId: (discordId: string) => Promise<{ memberId: string; name: string } | null>
  giveVouch: (voucherDiscordId: string, targetMemberId: string) => Promise<GiveVouchResult>
  /** True when this voucher would get the disavow warning for this target on the website. */
  disavowWarns: (voucherDiscordId: string, targetMemberId: string) => Promise<boolean>
  levelInfo: (discordId: string) => Promise<LevelInfo>
  profileStats: (discordId: string) => Promise<ProfileStats | null>
  appUrl: string
  fetchImpl?: typeof fetch
}

/** Markdown/mention-safe text for a reply. */
const esc = (s: string) => s.replace(/([*_`~|>\\[\]])/g, '\\$1').replace(/@/g, '@\u200b')

const link = (label: string, url: string) => `[${label}](<${url}>)`
const profileUrl = (base: string, memberId: string) => `${base}/profile/${encodeURIComponent(memberId)}`

const ICON = { done: '✅', pending: '⏳', todo: '⬜' } as const

/** The member's own level with what the next one needs. */
export function renderOwnLevel(info: LevelInfo, appUrl: string, author?: EmbedAuthor): Embed {
  const head = info.isMax ? 'You are at MAX level' : `You are level ${info.level}${info.title ? `: ${esc(info.title)}` : ''}`
  if (info.isMax) return makeEmbed('success', head, `That is every level there is. See ${link('your missions', `${appUrl}/missions`)}.`, { author })
  const lines = info.missions.map((m) => `${ICON[m.state]} ${esc(m.title)}`)
  const next = info.nextTitle ? `\n\nNext up: **${esc(info.nextTitle)}**` : ''
  return makeEmbed(
    'success',
    head,
    `${info.done}/${info.total} done to reach level ${info.level + 1}.\n\n${lines.join('\n')}${next}\n\n${link('Open your missions', `${appUrl}/missions`)}`,
    { author },
  )
}

/** Another member's level: level and title only. */
export function renderOtherLevel(targetDiscordId: string, info: LevelInfo, author?: EmbedAuthor): Embed {
  const level = info.isMax ? 'MAX level' : `level ${info.level}${info.title ? `: ${esc(info.title)}` : ''}`
  return makeEmbed('success', `<@${targetDiscordId}> is ${level}`, undefined, { author })
}

export function renderProfile(stats: ProfileStats, appUrl: string, author?: EmbedAuthor): Embed {
  const fields = [
    { name: 'Level', value: stats.isMax ? 'MAX' : `${stats.level}${stats.levelTitle ? `: ${esc(stats.levelTitle)}` : ''}`, inline: true },
    { name: 'Vouched for by', value: String(stats.vouchesReceived), inline: true },
    { name: 'Vouched for', value: String(stats.vouchesGiven), inline: true },
  ]
  if (stats.city) fields.push({ name: 'City', value: esc(stats.city), inline: true })
  if (stats.crews.length) fields.push({ name: 'Crews', value: esc(stats.crews.join(', ')).slice(0, 300), inline: true })
  return makeEmbed('success', esc(stats.name), link('Open profile', profileUrl(appUrl, stats.memberId)), { author, fields })
}

export function renderVouchFailure(r: Extract<GiveVouchResult, { ok: false }>, appUrl: string, author?: EmbedAuthor): Embed {
  const e = (h: string, b?: string) => makeEmbed('error', h, b, { author })
  switch (r.reason) {
    case 'no-profile':
      return e('Finish onboarding first.', `Join PizzaDAO at ${link(appUrl.replace(/^https?:\/\//, ''), appUrl)}, then you can vouch.`)
    case 'self':
      return e("You can't vouch for yourself.")
    case 'not-found':
      return e("They aren't a PizzaDAO member yet.")
    case 'duplicate':
      return e('You already vouched for them.')
    case 'limit':
      return e('Daily vouch limit reached.', `You can give ${r.limit} vouches per day. Try again tomorrow.`)
  }
}

async function editOriginal(job: MemberCommandJob, embed: Embed, fetchImpl: typeof fetch): Promise<void> {
  const res = await fetchImpl(`${API}/webhooks/${encodeURIComponent(job.applicationId)}/${encodeURIComponent(job.token)}/messages/@original`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed], allowed_mentions: { parse: [] } }),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Discord ${res.status} editing the /${job.name} reply`)
}

/** Build the reply for a job. Pure apart from the injected deps. */
export async function buildMemberCommandReply(job: MemberCommandJob, deps: MemberCommandDeps): Promise<Embed> {
  const { author } = job
  const self = !job.targetDiscordId || job.targetDiscordId === job.discordId
  const notMember = (id: string) => makeEmbed('error', `<@${id}> isn't a PizzaDAO member yet.`, undefined, { author })

  switch (job.name) {
    case 'vouch': {
      if (!job.targetDiscordId) return makeEmbed('error', 'Pick a member to vouch for.', undefined, { author })
      if (self) return renderVouchFailure({ ok: false, reason: 'self' }, deps.appUrl, author)
      const voucher = await deps.memberByDiscordId(job.discordId)
      if (!voucher) return renderVouchFailure({ ok: false, reason: 'no-profile' }, deps.appUrl, author)
      const target = await deps.memberByDiscordId(job.targetDiscordId)
      if (!target) {
        return makeEmbed('error', `<@${job.targetDiscordId}> isn't a PizzaDAO member yet.`, `Invite them: ${deps.appUrl}/join?ref=${encodeURIComponent(voucher.memberId)}`, { author })
      }
      if (await deps.disavowWarns(job.discordId, target.memberId)) {
        return makeEmbed('cooldown', 'Please vouch from their profile.', link('Open their profile', profileUrl(deps.appUrl, target.memberId)), { author })
      }
      const r = await deps.giveVouch(job.discordId, target.memberId)
      if (!r.ok) return renderVouchFailure(r, deps.appUrl, author)
      return makeEmbed('success', `You vouched for ${esc(r.targetName || target.name || 'them')}.`, link('Open their profile', profileUrl(deps.appUrl, target.memberId)), { author })
    }

    case 'level': {
      if (self) {
        if (!(await deps.memberByDiscordId(job.discordId))) return renderVouchFailure({ ok: false, reason: 'no-profile' }, deps.appUrl, author)
        return renderOwnLevel(await deps.levelInfo(job.discordId), deps.appUrl, author)
      }
      if (!(await deps.memberByDiscordId(job.targetDiscordId!))) return notMember(job.targetDiscordId!)
      return renderOtherLevel(job.targetDiscordId!, await deps.levelInfo(job.targetDiscordId!), author)
    }

    case 'profile': {
      const id = self ? job.discordId : job.targetDiscordId!
      const stats = await deps.profileStats(id)
      if (!stats) return self ? renderVouchFailure({ ok: false, reason: 'no-profile' }, deps.appUrl, author) : notMember(id)
      return renderProfile(stats, deps.appUrl, author)
    }
  }
}

/** Build the reply and edit the deferred message. Never throws. */
export async function runMemberCommand(job: MemberCommandJob, deps: MemberCommandDeps): Promise<void> {
  const fetchImpl = deps.fetchImpl ?? fetch
  try {
    await editOriginal(job, await buildMemberCommandReply(job, deps), fetchImpl)
  } catch (err) {
    console.error(`[/${job.name}] failed:`, err instanceof Error ? err.message : String(err))
    try {
      await editOriginal(job, makeEmbed('error', 'Something went wrong. Please try again.', undefined, { author: job.author }), fetchImpl)
    } catch {
      // the token may have expired; nothing more to do
    }
  }
}
