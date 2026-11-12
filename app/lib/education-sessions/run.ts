/**
 * Schedule an education session in one go: the Discord scheduled event (cover = the flyer), the
 * announcement with the flyer in the education channel, optionally the general announcements
 * channel, and the existing Telegram mirror.
 *
 *  - Off unless education.sessionAnnounceEnabled (EDUCATION_SESSION_ANNOUNCE_ENABLED set to off is a
 *    kill switch; previews only follow the env var, see settings/toggles). Disabled means nothing is
 *    created, not even the row. The flyer preview never goes through here.
 *  - Idempotency: a CrewSession row (unique crew + dedupe key) is claimed BEFORE anything is sent. Each
 *    step is claimed with a "PENDING" marker and then stores its Discord id, so a re-submit (double
 *    click, retry after a partial failure) only does the steps still missing. A step that failed
 *    definitively releases its marker; a crash mid-step leaves PENDING (a possible double post is worse
 *    than a missing one, and the lead sees it in the result).
 *  - A step whose channel setting is empty is skipped (event / education channel); the general channel
 *    is optional by design.
 */
import { prisma } from '@/app/lib/db'
import { getGuildChannels } from '@/app/lib/discord-channels'
import { DiscordPostError, discordScheduledEventRequest } from '@/app/lib/discord-rest'
import { savedChannelId } from '@/app/lib/settings/channels'
import { toggleEnabled } from '@/app/lib/settings/toggles'
import { enqueueMirror } from '@/app/lib/telegram/city-posts'
import { buildAnnouncement, buildEventPayload, dedupeKey, EDUCATION_CREW_ID, NO_MENTIONS, type SessionTimes } from './build'
import { renderFlyerPng } from './flyer'
import { postMessageWithFile } from './discord-file'

const PENDING = 'PENDING'
const SUPPRESS_EMBEDS = 1 << 2

export type StepResult = 'done' | 'already' | 'skipped' | 'failed' | 'uncertain'

export interface ScheduleResult {
  status: 'disabled' | 'not-configured' | 'scheduled' | 'partial' | 'already'
  sessionId?: string
  event?: StepResult
  announcement?: StepResult
  general?: StepResult
  telegram?: StepResult
  eventUrl?: string | null
  errors?: string[]
}

export interface ScheduleDeps {
  enabled?: () => Promise<boolean>
  channelId?: (key: 'discord.educationChannelId' | 'discord.educationEventChannelId' | 'discord.educationGeneralChannelId') => Promise<string>
  flyer?: typeof renderFlyerPng
  fetchImpl?: typeof fetch
  env?: NodeJS.ProcessEnv
}

const isUniqueViolation = (e: unknown) => typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002'

export async function scheduleEducationSession(s: SessionTimes, actorDiscordId: string, deps: ScheduleDeps = {}): Promise<ScheduleResult> {
  const env = deps.env ?? process.env
  if (!(await (deps.enabled ?? (() => toggleEnabled('education.sessionAnnounceEnabled', env)))())) return { status: 'disabled' }
  const token = env.DISCORD_BOT_TOKEN?.trim() ?? ''
  const guildId = env.DISCORD_GUILD_ID?.trim() ?? ''
  const getChannel = deps.channelId ?? savedChannelId
  const [eventChannelId, announceChannelId, generalChannelId] = await Promise.all([
    getChannel('discord.educationEventChannelId'),
    getChannel('discord.educationChannelId'),
    getChannel('discord.educationGeneralChannelId'),
  ])
  if (!token || !guildId || (!eventChannelId && !announceChannelId && !generalChannelId)) return { status: 'not-configured' }

  const key = dedupeKey(EDUCATION_CREW_ID, s)
  let row = await prisma.crewSession.findUnique({ where: { crewId_dedupeKey: { crewId: EDUCATION_CREW_ID, dedupeKey: key } } })
  const existed = !!row
  if (!row) {
    try {
      row = await prisma.crewSession.create({
        data: {
          crewId: EDUCATION_CREW_ID,
          dedupeKey: key,
          title: s.title,
          presenter: s.presenter,
          description: s.description,
          startsAt: s.startsAt,
          endsAt: s.endsAt,
          timeZone: s.timeZone,
          createdBy: actorDiscordId,
        },
      })
    } catch (e) {
      if (!isUniqueViolation(e)) throw e
      row = await prisma.crewSession.findUnique({ where: { crewId_dedupeKey: { crewId: EDUCATION_CREW_ID, dedupeKey: key } } })
      if (!row) throw e
    }
  }
  const id = row.id
  const errors: string[] = []
  const out: ScheduleResult = { status: 'scheduled', sessionId: id, errors }

  // Claim a step: only one caller flips the field from null to PENDING.
  const claim = async (field: 'eventId' | 'announceMessageId' | 'generalMessageId') =>
    (await prisma.crewSession.updateMany({ where: { id, [field]: null }, data: { [field]: PENDING } })).count === 1
  const release = (field: 'eventId' | 'announceMessageId' | 'generalMessageId') =>
    prisma.crewSession.updateMany({ where: { id, [field]: PENDING }, data: { [field]: null } })
  const store = (field: 'eventId' | 'announceMessageId' | 'generalMessageId', v: string | null) =>
    prisma.crewSession.updateMany({ where: { id, [field]: PENDING }, data: { [field]: v ?? PENDING } })
  const definitive = (err: unknown) => err instanceof DiscordPostError && err.status >= 400 && err.status < 500

  let flyer: Buffer | null = null
  const getFlyer = async () => {
    try {
      return (flyer ??= await (deps.flyer ?? renderFlyerPng)(s))
    } catch (e) {
      throw new DiscordPostError(`Could not render the flyer: ${e instanceof Error ? e.message : e}`, 400)
    }
  }

  // 1. Discord scheduled event, cover = flyer.
  let eventId = row.eventId && row.eventId !== PENDING ? row.eventId : null
  if (!eventChannelId) out.event = 'skipped'
  else if (row.eventId) out.event = row.eventId === PENDING ? 'uncertain' : 'already'
  else if (!(await claim('eventId'))) out.event = 'uncertain'
  else {
    try {
      const channels = await getGuildChannels({ botToken: token, guildId, fetchImpl: deps.fetchImpl })
      const ch = channels?.find((c) => c.id === eventChannelId)
      if (!ch) throw new DiscordPostError('The event channel was not found in the server.', 404)
      const png = await getFlyer()
      const created = (await discordScheduledEventRequest(
        { method: 'POST', guildId, botToken: token, body: buildEventPayload(s, ch, `data:image/png;base64,${png.toString('base64')}`), reason: 'Education session scheduled from the website' },
        { fetchImpl: deps.fetchImpl },
      )) as { id: string }
      eventId = created.id
      await store('eventId', created.id)
      out.event = 'done'
    } catch (err) {
      errors.push(`event: ${err instanceof Error ? err.message : String(err)}`)
      if (definitive(err)) {
        await release('eventId')
        out.event = 'failed'
      } else out.event = 'uncertain'
    }
  }
  out.eventUrl = eventId ? `https://discord.com/events/${guildId}/${eventId}` : null

  // 2 and 3. Announcement with the flyer: education channel, then the optional general channel.
  const post = async (field: 'announceMessageId' | 'generalMessageId', channelId: string): Promise<StepResult> => {
    if (!channelId) return 'skipped'
    const current = row![field]
    if (current) return current === PENDING ? 'uncertain' : 'already'
    if (!(await claim(field))) return 'uncertain'
    try {
      const png = await getFlyer()
      const { id: messageId } = await postMessageWithFile(
        { channelId, botToken: token },
        { content: buildAnnouncement(s, out.eventUrl ?? null), allowed_mentions: NO_MENTIONS, flags: SUPPRESS_EMBEDS },
        { name: 'flyer.png', type: 'image/png', data: png },
        deps.fetchImpl,
      )
      await store(field, messageId)
      return 'done'
    } catch (err) {
      errors.push(`${field === 'announceMessageId' ? 'announcement' : 'general'}: ${err instanceof Error ? err.message : String(err)}`)
      if (definitive(err)) {
        await release(field)
        return 'failed'
      }
      return 'uncertain'
    }
  }
  out.announcement = await post('announceMessageId', announceChannelId)
  out.general = generalChannelId && generalChannelId !== announceChannelId ? await post('generalMessageId', generalChannelId) : 'skipped'

  // 4. Telegram, through the existing mirror (its own switches and city mapping decide; never throws).
  if (row.telegramQueued) out.telegram = 'already'
  else if (out.announcement === 'done' || out.announcement === 'already') {
    const r = await enqueueMirror(
      { kind: 'announce', sourceId: `edu-session:${id}`, crewId: EDUCATION_CREW_ID, crewLabel: 'Education', text: buildAnnouncement(s, out.eventUrl ?? null), expiresAt: s.startsAt },
      env,
    )
    if (r.queued > 0) await prisma.crewSession.update({ where: { id }, data: { telegramQueued: true } })
    out.telegram = r.queued > 0 ? 'done' : 'skipped'
  } else out.telegram = 'skipped'

  const bad = [out.event, out.announcement, out.general].some((r) => r === 'failed' || r === 'uncertain')
  await prisma.crewSession.update({ where: { id }, data: { lastError: errors.length ? errors.join(' | ').slice(0, 500) : null } }).catch(() => {})
  if (bad) out.status = 'partial'
  else if (existed && ![out.event, out.announcement, out.general].includes('done')) out.status = 'already'
  return out
}
