/**
 * Consent for a suggested host match (plans/telegram-shared-bot.md, part 4). A TelegramHostMatch is
 * never used to message anyone until it is CONFIRMED, and CONFIRMED needs both sides:
 *
 *   (a) the member, logged in with Discord, says "yes, that's me" in the app, and
 *   (b) the holder of the Telegram account taps a signed link the shared bot DMs to it
 *       (host-match-token.ts), which opens /telegram/confirm/<token> and requires the SAME Discord
 *       session. That proves the Telegram holder and the app member are one person, even if the
 *       rsv.pizza email was mistyped or typed by someone else.
 *
 * The confirm page's own button is an explicit "yes" too, so a link tapped from a proactive invitation
 * (mode 2) also has both. Declining is final: the member is never asked again.
 * Every DM here goes through rsv-client (production only); the Login Widget always wins over a match.
 */
import type { HostMatchConsent } from '@prisma/client'
import { prisma } from '@/app/lib/db'
import { appUrl, loadFollowUpConfig } from '@/app/lib/followups/config'
import { linkSecret } from '@/app/lib/followups/links'
import { loadSettings } from '@/app/lib/settings'
import { SETTINGS } from '@/app/lib/settings/registry'
import { resolveToggle } from '@/app/lib/settings/toggles'
import { canTryTelegram, loadReach, recordResult } from './reach'
import { sendDm, telegramSendAllowed, type DmResult } from './rsv-client'
import { confirmUrl, keyedDiscordId, signConfirmToken, telegramFingerprint, verifyConfirmToken } from './host-match-token'

type Env = Record<string, string | undefined>

/** How long after a confirmation DM before the member can ask for another. */
export const RESEND_COOLDOWN_MS = 5 * 60 * 1000

type Loc = 'en' | 'es' | 'fr'
type Kind = 'confirm' | 'invite'
const loc = (l: string | null | undefined): Loc => ((l ?? 'en').slice(0, 2).toLowerCase() === 'es' ? 'es' : (l ?? '').slice(0, 2).toLowerCase() === 'fr' ? 'fr' : 'en')

/** Translations used only while the setting still holds its English default; an edited setting is sent as written. */
const FALLBACK: Record<Loc, Record<'confirmText' | 'confirmButton' | 'inviteText' | 'inviteButton', string>> = {
  en: { confirmText: '', confirmButton: '', inviteText: '', inviteButton: '' },
  es: {
    confirmText: 'Confirma este Telegram para tu cuenta de PizzaDAO. Toca el botón solo si lo acabas de pedir en la app de PizzaDAO.',
    confirmButton: 'Confirmar',
    inviteText: 'PizzaDAO quiere enviarte aquí los seguimientos de las llamadas. Toca el botón para confirmar, o ignora este mensaje.',
    inviteButton: 'Confirmar',
  },
  fr: {
    confirmText: "Confirmez ce Telegram pour votre compte PizzaDAO. N'appuyez sur le bouton que si vous venez de le demander dans l'app PizzaDAO.",
    confirmButton: 'Confirmer',
    inviteText: 'PizzaDAO aimerait vous envoyer ici les suivis des appels. Appuyez sur le bouton pour confirmer, ou ignorez ce message.',
    inviteButton: 'Confirmer',
  },
}

/** The DM text and button label (settings, with per-language fallbacks for the untouched defaults). */
async function dmText(kind: Kind, l: Loc): Promise<{ text: string; button: string }> {
  const s = await loadSettings()
  const pick = (field: 'Text' | 'Button') => {
    const key = `telegram.hostMatch${kind === 'confirm' ? 'Confirm' : 'Invite'}${field}` as const
    const v = s.get(key) as string
    const fb = FALLBACK[l][`${kind}${field}` as 'confirmText']
    return v === (SETTINGS[key].default as string) && fb ? fb : v
  }
  return { text: pick('Text'), button: pick('Button') }
}

const OPEN: HostMatchConsent[] = ['PENDING', 'INVITED']

/** The feature is on: toggle (production only), sender allowed, and a link secret to sign with. */
async function featureOn(env: Env): Promise<boolean> {
  return resolveToggle('telegram.hostMatchEnabled', await loadSettings(), env)
}

/** Sending the confirmation / invitation DM also needs telegram.dmEnabled. */
async function dmOn(env: Env): Promise<boolean> {
  return resolveToggle('telegram.dmEnabled', await loadSettings(), env)
}

/** A Telegram id some member linked with the Login Widget is never usable for a match. */
async function isLoginId(telegramId: string): Promise<boolean> {
  return !!(await prisma.telegramAccount.findUnique({ where: { telegramId }, select: { discordId: true } }))
}

export type CardState = 'none' | 'pending' | 'awaiting' | 'confirmed'

export interface Card {
  state: CardState
  /** First two characters of the Telegram handle, or null. Never the Telegram id. */
  handleHint: string | null
  /** The shared bot can be reached from here (false on previews: the card then only reads). */
  canSend: boolean
}

/** What the profile card shows for this member. */
export async function getCard(discordId: string, env: Env = process.env): Promise<Card> {
  const none: Card = { state: 'none', handleHint: null, canSend: false }
  if (!(await featureOn(env))) return none
  const m = await prisma.telegramHostMatch.findUnique({ where: { discordId }, select: { consent: true, handleHint: true, memberConfirmedAt: true } })
  if (!m || m.consent === 'DECLINED') return none
  // A Telegram login replaces any match.
  if (await prisma.telegramAccount.findUnique({ where: { discordId }, select: { discordId: true } })) return none
  const canSend = telegramSendAllowed(env) && !!linkSecret(env)
  const state: CardState = m.consent === 'CONFIRMED' ? 'confirmed' : m.memberConfirmedAt ? 'awaiting' : 'pending'
  return { state, handleHint: m.handleHint, canSend }
}

export type StartResult = 'sent' | 'not-found' | 'unavailable' | 'has-login' | 'wait' | 'not-started' | 'blocked' | 'try-later'

export interface Deps {
  env?: Env
  now?: Date
  send?: (a: { telegramUserId: string; text: string; buttons: Array<Array<{ text: string; url: string }>>; idempotencyKey: string }) => Promise<DmResult>
}

async function localeOf(memberId: string): Promise<Loc> {
  const x = await prisma.memberProfileExtras.findUnique({ where: { memberId }, select: { locale: true } }).catch(() => null)
  return loc(x?.locale)
}

/**
 * Side (a) and the DM for side (b): the member said "yes, that's me". Records the click, then asks the
 * shared bot to DM the signed link to the suggested Telegram account. `resend` repeats the DM later.
 */
export async function startConfirmation(discordId: string, resend: boolean, deps: Deps = {}): Promise<StartResult> {
  const env = deps.env ?? process.env
  const now = deps.now ?? new Date()
  if (!(await featureOn(env)) || !(await dmOn(env)) || !telegramSendAllowed(env) || !linkSecret(env)) return 'unavailable'
  const m = await prisma.telegramHostMatch.findUnique({ where: { discordId } })
  if (!m || !OPEN.includes(m.consent)) return 'not-found'
  if (resend && !m.memberConfirmedAt) return 'not-found'
  if (await prisma.telegramAccount.findUnique({ where: { discordId }, select: { discordId: true } })) return 'has-login'
  if (m.memberConfirmedAt && m.invitedAt && now.getTime() - m.invitedAt.getTime() < RESEND_COOLDOWN_MS) return 'wait'
  if (await isLoginId(m.telegramId)) return 'has-login'
  const cfg = await loadFollowUpConfig(env)
  const recheck = { dmRecheckDays: cfg.dmRecheckDays, dmRecheckMaxDays: cfg.dmRecheckMaxDays }

  const token = signConfirmToken(discordId, m.telegramId, now, env)
  if (!token) return 'unavailable'
  // Claim the send before making it: only one concurrent request gets past the cooldown.
  const claim = await prisma.telegramHostMatch.updateMany({
    where: { discordId, consent: { in: OPEN }, OR: [{ invitedAt: null }, { invitedAt: { lt: new Date(now.getTime() - RESEND_COOLDOWN_MS) } }] },
    data: { memberConfirmedAt: m.memberConfirmedAt ?? now, invitedAt: now },
  })
  if (claim.count !== 1) return 'wait'
  const release = () => prisma.telegramHostMatch.updateMany({ where: { discordId, consent: { in: OPEN } }, data: { invitedAt: m.invitedAt } }).catch(() => undefined)
  const t = await dmText('confirm', await localeOf(m.memberId))
  const send = deps.send ?? ((a) => sendDm(a, { env }))
  // One key per cooldown window: a repeat inside it replays the same send instead of duplicating it.
  const r = await send({ telegramUserId: m.telegramId, text: t.text, buttons: [[{ text: t.button, url: confirmUrl(token, env) }]], idempotencyKey: `tm:${discordId}:${now.getTime()}` })
  if (r.ok) {
    await recordResult(m.telegramId, 'ok', recheck, now).catch(() => {})
    return 'sent'
  }
  if (r.code === 'uncertain') return 'sent' // it may have gone out: the claim stays, so the cooldown stops repeats
  // Nothing was sent: free the claim so the member can try again.
  await release()
  if (r.code === 'not_started' || r.code === 'blocked') {
    await recordResult(m.telegramId, r.code, recheck, now).catch(() => {})
    return r.code === 'blocked' ? 'blocked' : 'not-started'
  }
  return r.code === 'rate_limited' || r.code === 'unavailable' ? 'try-later' : 'unavailable'
}

/** "No": final. Also how a member removes a confirmed match. Returns false when there was nothing to decline. */
export async function declineMatch(discordId: string, now = new Date()): Promise<boolean> {
  const r = await prisma.telegramHostMatch.updateMany({
    where: { discordId, consent: { not: 'DECLINED' } },
    data: { consent: 'DECLINED', decidedAt: now, memberConfirmedAt: null },
  })
  return r.count > 0
}

export type ConfirmView =
  | { ok: false; reason: 'invalid' | 'expired' | 'closed' }
  | { ok: false; reason: 'wrong-account' }
  | { ok: true; state: 'ready' | 'already'; handleHint: string | null }

/** Read-only look at a confirmation link for the page. */
export async function lookupConfirmation(token: string, sessionDiscordId: string, deps: Deps = {}): Promise<ConfirmView> {
  const env = deps.env ?? process.env
  const v = verifyConfirmToken(token, deps.now ?? new Date(), env)
  if (!v.ok) return v
  if (v.claims.d !== keyedDiscordId(sessionDiscordId, env)) return { ok: false, reason: 'wrong-account' }
  const m = await prisma.telegramHostMatch.findUnique({ where: { discordId: sessionDiscordId }, select: { telegramId: true, consent: true, handleHint: true } })
  if (!m || m.consent === 'DECLINED' || telegramFingerprint(m.telegramId, env) !== v.claims.h) return { ok: false, reason: 'closed' }
  return { ok: true, state: m.consent === 'CONFIRMED' ? 'already' : 'ready', handleHint: m.handleHint }
}

export type ConfirmResult = { ok: true } | { ok: false; reason: 'invalid' | 'expired' | 'closed' | 'wrong-account' | 'has-login' | 'conflict' | 'unavailable' }

/**
 * Both sides are present: the token (the Telegram holder), the same Discord session (the member) and
 * the explicit click that posted here. Marks the match CONFIRMED.
 */
export async function completeConfirmation(token: string, sessionDiscordId: string, deps: Deps = {}): Promise<ConfirmResult> {
  const env = deps.env ?? process.env
  const now = deps.now ?? new Date()
  if (!(await featureOn(env))) return { ok: false, reason: 'unavailable' }
  const v = verifyConfirmToken(token, now, env)
  if (!v.ok) return v
  if (v.claims.d !== keyedDiscordId(sessionDiscordId, env)) return { ok: false, reason: 'wrong-account' }
  const m = await prisma.telegramHostMatch.findUnique({ where: { discordId: sessionDiscordId } })
  if (!m || m.consent === 'DECLINED' || telegramFingerprint(m.telegramId, env) !== v.claims.h) return { ok: false, reason: 'closed' }
  if (m.consent === 'CONFIRMED') return { ok: true }
  // A widget login wins over a match, and one Telegram account belongs to one member.
  if (await prisma.telegramAccount.findFirst({ where: { OR: [{ discordId: sessionDiscordId }, { telegramId: m.telegramId }] }, select: { discordId: true } })) return { ok: false, reason: 'has-login' }
  const done = await prisma.telegramHostMatch.updateMany({
    where: { discordId: sessionDiscordId, telegramId: m.telegramId, consent: { in: OPEN } },
    data: { consent: 'CONFIRMED', memberConfirmedAt: now, decidedAt: now },
  })
  if (done.count !== 1) return { ok: false, reason: 'closed' }
  const cfg = await loadFollowUpConfig(env)
  await recordResult(m.telegramId, 'ok', { dmRecheckDays: cfg.dmRecheckDays, dmRecheckMaxDays: cfg.dmRecheckMaxDays }, now).catch(() => {})
  return { ok: true }
}

/**
 * Mode 2: the first time a follow-up goes to a member with an unanswered match, send ONE invitation
 * on Telegram (the follow-up itself still goes out on Discord). The row is claimed (PENDING -> INVITED)
 * before the send, so there is never a second invitation; a definite "not sent" puts it back.
 */
export async function maybeInvite(discordId: string, deps: Deps = {}): Promise<'invited' | 'skipped'> {
  const env = deps.env ?? process.env
  const now = deps.now ?? new Date()
  const settings = await loadSettings()
  if (!resolveToggle('telegram.hostMatchEnabled', settings, env) || !resolveToggle('telegram.dmEnabled', settings, env) || settings.get('telegram.hostMatchMode') < 2) return 'skipped'
  if (!telegramSendAllowed(env) || !linkSecret(env)) return 'skipped'
  const m = await prisma.telegramHostMatch.findUnique({ where: { discordId } })
  if (!m || m.consent !== 'PENDING') return 'skipped'
  if (await prisma.telegramAccount.findUnique({ where: { discordId }, select: { discordId: true } })) return 'skipped'
  if (await isLoginId(m.telegramId)) return 'skipped'
  if (!canTryTelegram(await loadReach(m.telegramId), now)) return 'skipped'
  const token = signConfirmToken(discordId, m.telegramId, now, env)
  if (!token) return 'skipped'
  const claim = await prisma.telegramHostMatch.updateMany({ where: { discordId, consent: 'PENDING' }, data: { consent: 'INVITED', invitedAt: now } })
  if (claim.count !== 1) return 'skipped'
  const cfg = await loadFollowUpConfig(env)
  const recheck = { dmRecheckDays: cfg.dmRecheckDays, dmRecheckMaxDays: cfg.dmRecheckMaxDays }
  const t = await dmText('invite', await localeOf(m.memberId))
  const send = deps.send ?? ((a) => sendDm(a, { env }))
  const r = await send({ telegramUserId: m.telegramId, text: t.text, buttons: [[{ text: t.button, url: confirmUrl(token, env) }]], idempotencyKey: `ti:${discordId}:${now.getTime()}` })
  if (r.ok) {
    await recordResult(m.telegramId, 'ok', recheck, now).catch(() => {})
    return 'invited'
  }
  if (r.code === 'not_started') await recordResult(m.telegramId, 'not_started', recheck, now).catch(() => {})
  // Nothing was sent (and the invitation can still be made later): release the claim. A blocked bot, a
  // bad request or an uncertain send stays INVITED, so there is no second try.
  if (r.code === 'not_started' || r.code === 'rate_limited' || r.code === 'unavailable' || r.code === 'not_configured') {
    await prisma.telegramHostMatch.updateMany({ where: { discordId, consent: 'INVITED' }, data: { consent: 'PENDING', invitedAt: null } })
  } else if (r.code === 'blocked') {
    await recordResult(m.telegramId, 'blocked', recheck, now).catch(() => {})
  }
  return r.code === 'uncertain' ? 'invited' : 'skipped'
}

/** The extra line for a Discord follow-up to a member with an unanswered match, or null. */
export async function discordPreferLine(discordId: string, memberId: string | null, env: Env = process.env): Promise<string | null> {
  if (!memberId) return null
  const settings = await loadSettings()
  if (!resolveToggle('telegram.hostMatchEnabled', settings, env)) return null
  const template = settings.get('telegram.hostMatchDiscordLine')
  if (!template) return null
  const m = await prisma.telegramHostMatch.findUnique({ where: { discordId }, select: { consent: true } })
  if (!m || m.consent !== 'PENDING') return null
  return template.replace('{link}', `${appUrl(env)}/profile/${memberId}/edit`)
}
