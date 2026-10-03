/**
 * Discord notifications for mission approvals and level-ups
 * (plans/mission-verification.md §4.2, decision D11):
 *
 *   - a DM from Pepperoni Bot to the member: on a level-up, and on an
 *     automatic approval the member didn't just watch happen (event hooks,
 *     cron); not for /missions, whose reply already shows it;
 *   - one public post in #work per level-up (MISSIONS_ANNOUNCE_CHANNEL_ID, else
 *     the channel named "work"), mentioning only the member
 *     (allowed_mentions users: [member], never @everyone / roles).
 *
 * In-app notifications are written by the engine and missions.ts. Everything
 * here is best effort (logged, never thrown) and is meant to run in `after()`.
 * Only sent while MISSION_VERIFIERS_ENABLED is on. Tests inject NotifyDeps, so
 * nothing reaches Discord.
 */
import { prisma } from '../db'
import { sendDM } from '../discord'
import { resolveChannelId } from '../discord-channels'
import { postDiscordMessage } from '../discord-rest'
import { makeEmbed, type Embed } from '../discord-interactions/embeds'
import { missionVerifiersEnabled } from './policy'
import type { Trigger } from './types'

export interface LevelInfo {
  level: number
  title: string | null
  reward: number
}

export interface NotifyDeps {
  enabled: () => boolean
  levelInfo: (levels: number[]) => Promise<LevelInfo[]>
  sendDM: (userId: string, content: string, embeds: Embed[]) => Promise<{ success: boolean; error?: string }>
  resolveAnnounceChannel: () => Promise<string | null>
  postToChannel: (channelId: string, body: { content: string; embeds: Embed[]; allowed_mentions: { parse: []; users: string[] } }) => Promise<void>
  currency: () => string
  appUrl: () => string
}

export const defaultNotifyDeps: NotifyDeps = {
  enabled: () => missionVerifiersEnabled(),
  async levelInfo(levels) {
    if (!levels.length) return []
    const rows = await prisma.mission.findMany({
      where: { level: { in: levels }, isActive: true },
      select: { level: true, levelTitle: true, reward: true },
      orderBy: [{ level: 'asc' }, { index: 'asc' }],
    })
    return levels.map((level) => {
      const r = rows.find((x) => x.level === level)
      return { level, title: r?.levelTitle ?? null, reward: r?.reward ?? 0 }
    })
  },
  sendDM: (userId, content, embeds) => sendDM(userId, content, { embeds }),
  resolveAnnounceChannel: () => resolveChannelId('work', 'MISSIONS_ANNOUNCE_CHANNEL_ID'),
  async postToChannel(channelId, body) {
    const botToken = process.env.DISCORD_BOT_TOKEN?.trim()
    if (!botToken) return
    await postDiscordMessage({ kind: 'bot', channelId, botToken }, body)
  },
  currency: () => process.env.PEP_EMOJI?.trim() || '$PEP',
  appUrl: () => (process.env.NEXT_PUBLIC_APP_URL?.trim() || 'https://app.pizzadao.org').replace(/\/$/, ''),
}

export interface AnnounceInput {
  discordId: string
  trigger: Trigger | 'review'
  /** Titles of missions approved (automatically or by a reviewer) in this run. */
  approvedTitles: string[]
  levelsPaid: number[]
}

const n = (v: number) => v.toLocaleString('en-US')

/** DM + #work post. Returns what was sent (for logs and tests). */
export async function announceMissionResults(
  input: AnnounceInput,
  deps: NotifyDeps = defaultNotifyDeps,
): Promise<{ dm: boolean; posted: boolean }> {
  const sent = { dm: false, posted: false }
  if (!deps.enabled()) return sent
  const { discordId, approvedTitles, levelsPaid, trigger } = input
  const watching = trigger === 'discord' || trigger === 'on_demand' || trigger === 'submit' || trigger === 'review'
  const dmApprovals = approvedTitles.length > 0 && !watching && trigger !== 'backfill'
  if (!levelsPaid.length && !dmApprovals) return sent

  try {
    const levels = await deps.levelInfo(levelsPaid)
    const cur = deps.currency()
    const link = `${deps.appUrl()}/missions`
    const total = levels.reduce((s, l) => s + l.reward, 0)
    const levelLine = (l: LevelInfo) => `Level ${l.level}${l.title ? ` (${l.title})` : ''}: +${cur} ${n(l.reward)}`

    // DM the member (no DM blast on backfills, §4.2).
    if (trigger !== 'backfill' && (levels.length || dmApprovals)) {
      const lines: string[] = []
      if (approvedTitles.length) lines.push('Verified:', ...approvedTitles.map((t) => `✔ ${t}`), '')
      if (levels.length) lines.push(...levels.map(levelLine), '')
      lines.push(`[See your missions](<${link}>)`)
      const headline = levels.length
        ? `🍕 Level ${levels[levels.length - 1].level} complete! +${cur} **${n(total)}**`
        : `Mission${approvedTitles.length > 1 ? 's' : ''} verified!`
      const r = await deps.sendDM(discordId, '', [makeEmbed('success', headline, lines.join('\n'))])
      sent.dm = r.success
      if (!r.success && r.error !== 'dms_disabled') console.warn('[missions] level-up DM failed:', r.error)
    }

    // One public celebration post per level-up run, in #work.
    if (levels.length) {
      const channelId = await deps.resolveAnnounceChannel()
      if (!channelId) {
        console.warn('[missions] no #work channel (set MISSIONS_ANNOUNCE_CHANNEL_ID); skipping the level-up post')
      } else {
        const top = levels[levels.length - 1]
        const body =
          `🍕 <@${discordId}> reached **Level ${top.level}${top.title ? ` · ${top.title}` : ''}** and earned ${cur} **${n(total)}**!` +
          (levels.length > 1 ? `\n\n${levels.map(levelLine).join('\n')}` : '') +
          `\n\n[Missions](<${link}>)`
        await deps.postToChannel(channelId, {
          content: `<@${discordId}>`,
          embeds: [makeEmbed('success', 'Level up!', body)],
          allowed_mentions: { parse: [], users: [discordId] },
        })
        sent.posted = true
      }
    }
  } catch (err) {
    console.error('[missions] Discord notification failed:', err)
  }
  return sent
}
