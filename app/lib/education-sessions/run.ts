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
 *  - Each message's channel id is stored with it; edit/cancel use that channel (rows from before fall back to the setting).
 *  - Edit and cancel work on the SAME row, event and messages (PATCH, never a new event or post): the
 *    dedupe key only guards creation, so fixing a typo cannot make a second event or announcement.
 */
import { createHash } from 'crypto'
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
const CHANNEL_FIELD = { announceMessageId: 'announceChannelId', generalMessageId: 'generalChannelId' } as const
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

/** The dedupe key a canceled row is renamed to, so its (crew, title, time) key is free again. */
const freedKey = (r: { id: string; dedupeKey: string }) => (r.dedupeKey.includes('~') ? r.dedupeKey : `${r.dedupeKey}~${r.id}`)

const definitiveError = (err: unknown) => err instanceof DiscordPostError && err.status >= 400 && err.status < 500

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
  if (row?.status === SESSION_STATUS.CANCELED) {
    // A canceled session no longer holds its key (cancel frees it; this covers rows canceled before that), so the same
    // title and time can be scheduled again as a new session.
    await prisma.crewSession.update({ where: { id: row.id }, data: { dedupeKey: freedKey(row) } })
    row = null
  }
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
  const store = (field: 'eventId' | 'announceMessageId' | 'generalMessageId', v: string | null, channelId?: string) =>
    prisma.crewSession.updateMany({
      where: { id, [field]: PENDING },
      data: { [field]: v ?? PENDING, ...(channelId && field !== 'eventId' ? { [CHANNEL_FIELD[field]]: channelId } : {}) },
    })
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
      await store(field, messageId, channelId)
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
  for (const field of ['eventId', 'announceMessageId', 'generalMessageId', 'noteKey'] as const) {
    cleared += (await prisma.crewSession.updateMany({ where: { id: sessionId, [field]: PENDING }, data: { [field]: null } })).count
  }
  return { cleared }
}

const real = (id: string | null | undefined): id is string => !!id && id !== PENDING

/** Discord says the thing is gone (Unknown Message / Unknown Event): the stored id can never work again. */
const isGone = (err: unknown) =>
  err instanceof DiscordPostError && err.status === 404 && /unknown (message|event)|\b10008\b|\b10070\b/i.test(err.message)

type IdField = 'eventId' | 'announceMessageId' | 'generalMessageId'

/**
 * Edit/cancel plumbing shared by both: `attempt` runs a Discord call; when Discord answers 404 Unknown
 * Message / Unknown Event it clears the stored id (and channel) so the manage page shows the step as missing
 * and Retry can post it again.
 */
function makeAttempt(sessionId: string, errors: string[]) {
  return async (label: string, fn: () => Promise<void>, clear?: { field: IdField; value: string }): Promise<EditStep> => {
    try {
      await fn()
      return 'done'
    } catch (err) {
      errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`)
      if (clear && isGone(err)) {
        const channelField = clear.field === 'eventId' ? {} : { [CHANNEL_FIELD[clear.field]]: null }
        await prisma.crewSession
          .updateMany({ where: { id: sessionId, [clear.field]: clear.value }, data: { [clear.field]: null, ...channelField } })
          .catch(() => {})
      }
      return 'failed'
    }
  }
}

/**
 * Record the outcome of an edit/cancel in lastError: the errors of this run, or cleared only when no
 * configured step is still missing (a step that never posted keeps the earlier error for the lead to see).
 */
async function recordOutcome(sessionId: string, cfg: Config, errors: string[]) {
  try {
    if (errors.length) {
      await prisma.crewSession.update({ where: { id: sessionId }, data: { lastError: errors.join(' | ').slice(0, 500) } })
      return
    }
    const fresh = await prisma.crewSession.findUnique({ where: { id: sessionId } })
    if (!fresh) return
    const missing =
      (!!cfg.eventChannelId && !real(fresh.eventId)) ||
      (!!cfg.announceChannelId && !real(fresh.announceMessageId)) ||
      (!!cfg.generalChannelId && cfg.generalChannelId !== cfg.announceChannelId && !real(fresh.generalMessageId)) ||
      fresh.noteKey === PENDING // an unclear update note is still unresolved
    if (!missing) await prisma.crewSession.update({ where: { id: sessionId }, data: { lastError: null } })
  } catch {
    /* best effort */
  }
}

export type EditStep = 'done' | 'skipped' | 'failed'

export interface ChangeResult {
  status: 'edited' | 'canceled' | 'not-found' | 'ended' | 'disabled'
  /** Cancel only: it was already canceled before this call (the steps still ran again to finish any that failed). */
  alreadyCanceled?: boolean
  event?: EditStep
  announcement?: EditStep
  general?: EditStep
  note?: EditStep | 'already' | 'uncertain'
  errors?: string[]
}

type ChangeDeps = ScheduleDeps & { editEnabled?: () => Promise<boolean> }

/** What an update note announced: the same title and time never gets a second note. */
const noteKeyOf = (s: SessionTimes) => createHash('sha256').update(`${s.title.trim().toLowerCase()}\n${s.startsAt.toISOString()}`).digest('hex').slice(0, 24)

/**
 * Edit a scheduled session IN PLACE: update the row, then PATCH the existing Discord event (and its
 * cover), the announcement and the general post (content + new flyer replacing the old one). Nothing
 * is created, so there is no second event or post; a step with no stored id (it failed earlier, or Discord
 * said it is gone) is left for "Retry", which posts it with the new fields. Telegram is not edited (it has
 * no edit hook); the optional update note is a Discord reply, claimed first so a re-submit cannot post it
 * twice. Needs both the edit switch and the announce switch.
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
  const attempt = makeAttempt(sessionId, errors)

  out.event = real(row.eventId)
    ? await attempt(
        'event',
        async () => {
          const png = await flyer(s, 'cover')
          await discordScheduledEventRequest(
            { method: 'PATCH', guildId, eventId: row.eventId!, botToken: token, body: buildEventPatch(s, `data:image/png;base64,${png.toString('base64')}`), reason: 'Education session edited from the website' },
            { fetchImpl: deps.fetchImpl },
          )
        },
        { field: 'eventId', value: row.eventId! },
      )
    : 'skipped'
  const eventUrl = real(row.eventId) ? `https://discord.com/events/${guildId}/${row.eventId}` : null

  // The channel the message was posted to (stored with it); rows from before that fall back to the current setting.
  const editPost = async (field: 'announceMessageId' | 'generalMessageId', storedChannel: string | null, settingChannel: string, label: string): Promise<EditStep> => {
    const messageId = row[field]
    const channelId = storedChannel || settingChannel
    if (!real(messageId) || !channelId) return 'skipped'
    return attempt(
      label,
      async () => {
        const png = await flyer(s, 'post')
        await editMessageWithFile(
          { channelId, messageId, botToken: token },
          { content: buildAnnouncement(s, eventUrl), allowed_mentions: NO_MENTIONS, flags: SUPPRESS_EMBEDS },
          { name: 'flyer.png', type: 'image/png', data: png },
          deps.fetchImpl,
        )
      },
      { field, value: messageId },
    )
  }
  out.announcement = await editPost('announceMessageId', row.announceChannelId, cfg.announceChannelId, 'announcement')
  out.general = cfg.generalChannelId !== cfg.announceChannelId ? await editPost('generalMessageId', row.generalChannelId, cfg.generalChannelId, 'general') : 'skipped'

  const noteChannel = row.announceChannelId || cfg.announceChannelId
  if (opts.notify && real(row.announceMessageId) && noteChannel && out.announcement === 'done') {
    const key = noteKeyOf(s)
    const prevNote = row.noteKey
    // Claim the note (same pattern as the steps): only one caller flips noteKey to PENDING, and a note for this
    // title/time that already went out (noteKey === key) is not posted again.
    const claimed = await prisma.crewSession.updateMany({ where: { id: sessionId, OR: [{ noteKey: null }, { noteKey: { notIn: [key, PENDING] } }] }, data: { noteKey: PENDING } })
    if (claimed.count !== 1) {
      // PENDING means a note went out unclearly (or is being sent): not "already posted".
      const now = await prisma.crewSession.findUnique({ where: { id: sessionId }, select: { noteKey: true } })
      out.note = now?.noteKey === PENDING ? 'uncertain' : 'already'
    } else {
      out.note = await attempt('update note', async () => {
        try {
          await postDiscordMessage(
            { kind: 'bot', channelId: noteChannel, botToken: token },
            { content: buildUpdateNote(s), allowed_mentions: NO_MENTIONS, flags: SUPPRESS_EMBEDS, message_reference: { message_id: row.announceMessageId!, fail_if_not_exists: false } } as never,
            { fetchImpl: deps.fetchImpl },
          )
        } catch (err) {
          // A definitive refusal released the claim (the lead can press again); anything unclear stays PENDING
          // (a possible double note is worse than a missing one).
          if (definitiveError(err)) await prisma.crewSession.updateMany({ where: { id: sessionId, noteKey: PENDING }, data: { noteKey: prevNote } })
          throw err
        }
        await prisma.crewSession.updateMany({ where: { id: sessionId, noteKey: PENDING }, data: { noteKey: key } })
      })
    }
  }
  await recordOutcome(sessionId, cfg, errors)
  return out
}

/**
 * Cancel a session: mark the row (and free its dedupe key, so the same title and time can be scheduled again),
 * set the Discord event to CANCELED and edit the announcement(s) to start with "Cancelled:" (the flyer stays;
 * posts are never deleted). Safe to repeat: pressing it again re-runs the Discord steps that failed.
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
      data: { status: SESSION_STATUS.CANCELED, canceledAt: new Date(), updatedBy: actorDiscordId, dedupeKey: freedKey(row) },
    })
  }
  const out: ChangeResult = { status: 'canceled', alreadyCanceled, errors: [] }
  const errors = out.errors!
  const cfg = await loadConfig(deps)
  if (!cfg) {
    out.event = out.announcement = out.general = 'skipped'
    return out
  }
  const attempt = makeAttempt(sessionId, errors)
  out.event = real(row.eventId)
    ? await attempt(
        'event',
        async () => {
          await discordScheduledEventRequest(
            { method: 'PATCH', guildId: cfg.guildId, eventId: row.eventId!, botToken: cfg.token, body: { status: EVENT_STATUS_CANCELED }, reason: 'Education session canceled from the website' },
            { fetchImpl: deps.fetchImpl },
          )
        },
        { field: 'eventId', value: row.eventId! },
      )
    : 'skipped'
  const content = buildCancelledAnnouncement(rowToTimes(row))
  const cancelPost = async (field: 'announceMessageId' | 'generalMessageId', storedChannel: string | null, settingChannel: string, label: string): Promise<EditStep> => {
    const messageId = row[field]
    const channelId = storedChannel || settingChannel
    if (!real(messageId) || !channelId) return 'skipped'
    // No `attachments` key: Discord keeps the flyer as it is.
    return attempt(label, () => editDiscordMessage({ channelId, messageId, botToken: cfg.token }, { content, allowed_mentions: NO_MENTIONS }, { fetchImpl: deps.fetchImpl }), { field, value: messageId })
  }
  out.announcement = await cancelPost('announceMessageId', row.announceChannelId, cfg.announceChannelId, 'announcement')
  out.general = cfg.generalChannelId !== cfg.announceChannelId ? await cancelPost('generalMessageId', row.generalChannelId, cfg.generalChannelId, 'general') : 'skipped'
  await recordOutcome(sessionId, cfg, errors)
  return out
}
