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
 *  - Edit and cancel work on the SAME row, event and messages (PATCH, never a new event or post): the
 *    dedupe key only guards creation, so fixing a typo cannot make a second event or announcement.
 */
import { prisma } from '@/app/lib/db'
import { getGuildChannels } from '@/app/lib/discord-channels'
import { DiscordPostError, discordScheduledEventRequest, editDiscordMessage, postDiscordMessage } from '@/app/lib/discord-rest'
import { savedChannelId } from '@/app/lib/settings/channels'
import { toggleEnabled } from '@/app/lib/settings/toggles'
import { enqueueMirror } from '@/app/lib/telegram/city-posts'
import {
  buildAnnouncement,
  buildCancelledAnnouncement,
  buildEventPatch,
  buildEventPayload,
  buildTelegramText,
  buildUpdateNote,
  dedupeKey,
  EVENT_STATUS_CANCELED,
  NO_MENTIONS,
  rowToTimes,
  SESSION_STATUS,
  type SessionExtras,
  type SessionTimes,
} from './build'
import { renderFlyerPng, type FlyerVariant } from './flyer'
import { editMessageWithFile, postMessageWithFile } from './discord-file'
import type { CrewSession } from '@prisma/client'

const PENDING = 'PENDING'
const SUPPRESS_EMBEDS = 1 << 2

export type StepResult = 'done' | 'already' | 'skipped' | 'failed' | 'uncertain'

export interface ScheduleResult {
  status: 'disabled' | 'not-configured' | 'scheduled' | 'partial' | 'already' | 'canceled'
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
  flyer?: (s: SessionTimes, variant: FlyerVariant) => Promise<Buffer>
  fetchImpl?: typeof fetch
  env?: NodeJS.ProcessEnv
}

const isUniqueViolation = (e: unknown) => typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002'

interface Config {
  token: string
  guildId: string
  eventChannelId: string
  announceChannelId: string
  generalChannelId: string
}

async function loadConfig(deps: ScheduleDeps): Promise<Config | null> {
  const env = deps.env ?? process.env
  const token = env.DISCORD_BOT_TOKEN?.trim() ?? ''
  const guildId = env.DISCORD_GUILD_ID?.trim() ?? ''
  const getChannel = deps.channelId ?? savedChannelId
  const [eventChannelId, announceChannelId, generalChannelId] = await Promise.all([
    getChannel('discord.educationEventChannelId'),
    getChannel('discord.educationChannelId'),
    getChannel('discord.educationGeneralChannelId'),
  ])
  if (!token || !guildId || (!eventChannelId && !announceChannelId && !generalChannelId)) return null
  return { token, guildId, eventChannelId, announceChannelId, generalChannelId }
}

const announceEnabled = (deps: ScheduleDeps) => (deps.enabled ?? (() => toggleEnabled('education.sessionAnnounceEnabled', deps.env ?? process.env)))()

export async function scheduleEducationSession(
  crewId: string,
  s: SessionTimes,
  actorDiscordId: string,
  deps: ScheduleDeps = {},
  extras: SessionExtras = { public: true, recordingUrl: null },
): Promise<ScheduleResult> {
  if (!(await announceEnabled(deps))) return { status: 'disabled' }
  const cfg = await loadConfig(deps)
  if (!cfg) return { status: 'not-configured' }

  const key = dedupeKey(crewId, s)
  let row = await prisma.crewSession.findUnique({ where: { crewId_dedupeKey: { crewId, dedupeKey: key } } })
  const existed = !!row
  if (!row) {
    try {
      row = await prisma.crewSession.create({
        data: {
          crewId,
          dedupeKey: key,
          title: s.title,
          presenter: s.presenter,
          description: s.description,
          startsAt: s.startsAt,
          endsAt: s.endsAt,
          timeZone: s.timeZone,
          createdBy: actorDiscordId,
          updatedBy: actorDiscordId,
          public: extras.public,
          recordingUrl: extras.recordingUrl,
        },
      })
    } catch (e) {
      if (!isUniqueViolation(e)) throw e
      row = await prisma.crewSession.findUnique({ where: { crewId_dedupeKey: { crewId, dedupeKey: key } } })
      if (!row) throw e
    }
  }
  if (row.status === SESSION_STATUS.CANCELED) return { status: 'canceled', sessionId: row.id }
  return runSteps(row, s, cfg, deps, existed)
}

/** Retry the missing steps of an existing session (a failed event or post), with its stored fields. */
export async function retrySession(sessionId: string, deps: ScheduleDeps = {}): Promise<ScheduleResult | { status: 'not-found' | 'ended' }> {
  if (!(await announceEnabled(deps))) return { status: 'disabled' }
  const row = await prisma.crewSession.findUnique({ where: { id: sessionId } })
  if (!row) return { status: 'not-found' }
  if (row.status === SESSION_STATUS.CANCELED) return { status: 'canceled', sessionId }
  if (row.endsAt.getTime() < Date.now()) return { status: 'ended' }
  const cfg = await loadConfig(deps)
  if (!cfg) return { status: 'not-configured' }
  return runSteps(row, rowToTimes(row), cfg, deps, true)
}

async function runSteps(row: CrewSession, s: SessionTimes, cfg: Config, deps: ScheduleDeps, existed: boolean): Promise<ScheduleResult> {
  const env = deps.env ?? process.env
  const { token, guildId, eventChannelId, announceChannelId, generalChannelId } = cfg
  const crewId = row.crewId
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

  const flyers: Partial<Record<FlyerVariant, Buffer>> = {}
  const getFlyer = async (variant: FlyerVariant) => {
    try {
      return (flyers[variant] ??= await (deps.flyer ?? renderFlyerPng)(s, variant))
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
      const png = await getFlyer('cover')
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
      const png = await getFlyer('post')
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

  // 4. Telegram, through the existing mirror as kind 'session' (telegram.sessionMirrorEnabled + the crew's
  // city mapping decide; never throws).
  if (row.telegramQueued) out.telegram = 'already'
  else if (out.announcement === 'done' || out.announcement === 'already') {
    const r = await enqueueMirror(
      { kind: 'session', sourceId: `edu-session:${id}`, crewId, crewLabel: crewId.charAt(0).toUpperCase() + crewId.slice(1), text: buildTelegramText(s, out.eventUrl ?? null), expiresAt: s.startsAt },
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

/**
 * Admin recovery: clear the PENDING markers of a session (steps left "unclear" by a crash or a 5xx), so
 * the next Schedule retries them. The admin must first check Discord for a half-made event or post.
 */
export async function resetPendingSteps(sessionId: string): Promise<{ cleared: number }> {
  let cleared = 0
  for (const field of ['eventId', 'announceMessageId', 'generalMessageId'] as const) {
    cleared += (await prisma.crewSession.updateMany({ where: { id: sessionId, [field]: PENDING }, data: { [field]: null } })).count
  }
  return { cleared }
}

const real = (id: string | null | undefined): id is string => !!id && id !== PENDING

export type EditStep = 'done' | 'skipped' | 'failed'

export interface ChangeResult {
  status: 'edited' | 'canceled' | 'not-found' | 'ended' | 'disabled'
  /** Cancel only: it was already canceled before this call (the steps still ran again to finish any that failed). */
  alreadyCanceled?: boolean
  event?: EditStep
  announcement?: EditStep
  general?: EditStep
  note?: EditStep
  errors?: string[]
}

type ChangeDeps = ScheduleDeps & { editEnabled?: () => Promise<boolean> }

/**
 * Edit a scheduled session IN PLACE: update the row, then PATCH the existing Discord event (and its
 * cover), the announcement and the general post (content + new flyer replacing the old one). Nothing
 * is created, so there is no second event or post; a step with no stored id (it failed earlier) is
 * left for "Retry", which posts it with the new fields. Telegram is not edited (it has no edit hook);
 * the optional update note is a Discord reply. Needs both the edit switch and the announce switch.
 */
export async function editSession(
  sessionId: string,
  s: SessionTimes,
  extras: SessionExtras,
  actorDiscordId: string,
  opts: { notify?: boolean } = {},
  deps: ChangeDeps = {},
): Promise<ChangeResult> {
  const env = deps.env ?? process.env
  const editOn = await (deps.editEnabled ?? (() => toggleEnabled('education.editEnabled', env)))()
  if (!editOn || !(await announceEnabled(deps))) return { status: 'disabled' }
  const row = await prisma.crewSession.findUnique({ where: { id: sessionId } })
  if (!row) return { status: 'not-found' }
  if (row.status === SESSION_STATUS.CANCELED) return { status: 'canceled' }
  if (row.endsAt.getTime() < Date.now()) return { status: 'ended' }

  const data = {
    title: s.title,
    presenter: s.presenter,
    description: s.description,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    timeZone: s.timeZone,
    public: extras.public,
    recordingUrl: extras.recordingUrl,
    updatedBy: actorDiscordId,
  }
  try {
    await prisma.crewSession.update({ where: { id: sessionId }, data: { ...data, dedupeKey: dedupeKey(row.crewId, s) } })
  } catch (e) {
    if (!isUniqueViolation(e)) throw e
    // Another session already has this title and time: keep our old key (it only guards creation).
    await prisma.crewSession.update({ where: { id: sessionId }, data })
  }

  const out: ChangeResult = { status: 'edited', errors: [] }
  const errors = out.errors!
  const cfg = await loadConfig(deps)
  if (!cfg) {
    out.event = out.announcement = out.general = 'skipped'
    return out
  }
  const { token, guildId } = cfg
  const flyer = deps.flyer ?? renderFlyerPng
  const attempt = async (label: string, fn: () => Promise<void>): Promise<EditStep> => {
    try {
      await fn()
      return 'done'
    } catch (err) {
      errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`)
      return 'failed'
    }
  }

  out.event = real(row.eventId)
    ? await attempt('event', async () => {
        const png = await flyer(s, 'cover')
        await discordScheduledEventRequest(
          { method: 'PATCH', guildId, eventId: row.eventId!, botToken: token, body: buildEventPatch(s, `data:image/png;base64,${png.toString('base64')}`), reason: 'Education session edited from the website' },
          { fetchImpl: deps.fetchImpl },
        )
      })
    : 'skipped'
  const eventUrl = real(row.eventId) ? `https://discord.com/events/${guildId}/${row.eventId}` : null

  const editPost = async (messageId: string | null, channelId: string, label: string): Promise<EditStep> => {
    if (!real(messageId) || !channelId) return 'skipped'
    return attempt(label, async () => {
      const png = await flyer(s, 'post')
      await editMessageWithFile(
        { channelId, messageId, botToken: token },
        { content: buildAnnouncement(s, eventUrl), allowed_mentions: NO_MENTIONS, flags: SUPPRESS_EMBEDS },
        { name: 'flyer.png', type: 'image/png', data: png },
        deps.fetchImpl,
      )
    })
  }
  out.announcement = await editPost(row.announceMessageId, cfg.announceChannelId, 'announcement')
  out.general = cfg.generalChannelId !== cfg.announceChannelId ? await editPost(row.generalMessageId, cfg.generalChannelId, 'general') : 'skipped'

  if (opts.notify && real(row.announceMessageId) && cfg.announceChannelId) {
    out.note = await attempt('update note', async () => {
      await postDiscordMessage(
        { kind: 'bot', channelId: cfg.announceChannelId, botToken: token },
        { content: buildUpdateNote(s), allowed_mentions: NO_MENTIONS, flags: SUPPRESS_EMBEDS, message_reference: { message_id: row.announceMessageId!, fail_if_not_exists: false } } as never,
        { fetchImpl: deps.fetchImpl },
      )
    })
  }
  await prisma.crewSession.update({ where: { id: sessionId }, data: { lastError: errors.length ? errors.join(' | ').slice(0, 500) : null } }).catch(() => {})
  return out
}

/**
 * Cancel a session: mark the row, set the Discord event to CANCELED and edit the announcement(s) to start
 * with "Cancelled:" (the flyer stays; posts are never deleted). Safe to repeat: pressing it again re-runs
 * the Discord steps that failed.
 */
export async function cancelSession(sessionId: string, actorDiscordId: string, deps: ChangeDeps = {}): Promise<ChangeResult> {
  const env = deps.env ?? process.env
  const editOn = await (deps.editEnabled ?? (() => toggleEnabled('education.editEnabled', env)))()
  if (!editOn || !(await announceEnabled(deps))) return { status: 'disabled' }
  const row = await prisma.crewSession.findUnique({ where: { id: sessionId } })
  if (!row) return { status: 'not-found' }
  const alreadyCanceled = row.status === SESSION_STATUS.CANCELED
  if (!alreadyCanceled && row.endsAt.getTime() < Date.now()) return { status: 'ended' }
  if (!alreadyCanceled) {
    await prisma.crewSession.updateMany({
      where: { id: sessionId, status: { not: SESSION_STATUS.CANCELED } },
      data: { status: SESSION_STATUS.CANCELED, canceledAt: new Date(), updatedBy: actorDiscordId },
    })
  }
  const out: ChangeResult = { status: 'canceled', alreadyCanceled, errors: [] }
  const errors = out.errors!
  const cfg = await loadConfig(deps)
  if (!cfg) {
    out.event = out.announcement = out.general = 'skipped'
    return out
  }
  const attempt = async (label: string, fn: () => Promise<void>): Promise<EditStep> => {
    try {
      await fn()
      return 'done'
    } catch (err) {
      errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`)
      return 'failed'
    }
  }
  out.event = real(row.eventId)
    ? await attempt('event', async () => {
        await discordScheduledEventRequest(
          { method: 'PATCH', guildId: cfg.guildId, eventId: row.eventId!, botToken: cfg.token, body: { status: EVENT_STATUS_CANCELED }, reason: 'Education session canceled from the website' },
          { fetchImpl: deps.fetchImpl },
        )
      })
    : 'skipped'
  const content = buildCancelledAnnouncement(rowToTimes(row))
  const cancelPost = async (messageId: string | null, channelId: string, label: string): Promise<EditStep> => {
    if (!real(messageId) || !channelId) return 'skipped'
    // No `attachments` key: Discord keeps the flyer as it is.
    return attempt(label, () => editDiscordMessage({ channelId, messageId, botToken: cfg.token }, { content, allowed_mentions: NO_MENTIONS }, { fetchImpl: deps.fetchImpl }))
  }
  out.announcement = await cancelPost(row.announceMessageId, cfg.announceChannelId, 'announcement')
  out.general = cfg.generalChannelId !== cfg.announceChannelId ? await cancelPost(row.generalMessageId, cfg.generalChannelId, 'general') : 'skipped'
  await prisma.crewSession.update({ where: { id: sessionId }, data: { lastError: errors.length ? errors.join(' | ').slice(0, 500) : null } }).catch(() => {})
  return out
}
