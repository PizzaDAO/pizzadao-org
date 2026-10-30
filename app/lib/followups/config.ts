/**
 * Follow-up settings, read from the DB settings registry (app/lib/settings). Sending is OFF unless
 * ALL of these hold: this is a production deploy (VERCEL_ENV=production; previews share the prod database and
 * must never message anyone), the env kill switch is not "off", the setting followups.sendEnabled is 1, and
 * the settings could be read. Anything unreadable means nothing is sent.
 */
import { loadSettings } from '@/app/lib/settings'
import { resolveToggle } from '@/app/lib/settings/toggles'

export interface FollowUpConfig {
  sendEnabled: boolean
  draftEnabled: boolean
  /** Empty = every call. */
  draftCrews: string[]
  maxPerDay: number
  quietStartHour: number
  quietEndHour: number
  escalationDiscordIds: string[]
  footerTelegram: string
  footerDiscord: string
  maxAlertsPerDay: number
  approvalMaxDays: number
  unknownTzStartHour: number
  unknownTzEndHour: number
  /** Telegram DMs over the shared sender bot (telegram.dmEnabled; needs sendEnabled too). */
  telegramDmEnabled: boolean
  dmRecheckDays: number
  dmRecheckMaxDays: number
  linkTtlDays: number
  snoozeDays: number
}

/** FOLLOWUPS_SEND_ENABLED set to off/0/false/no always wins over the setting. */
export function envSendOff(env: Record<string, string | undefined> = process.env): boolean {
  const v = env.FOLLOWUPS_SEND_ENABLED?.trim().toLowerCase()
  return v === 'off' || v === '0' || v === 'false' || v === 'no'
}

export function parseList(raw: string): string[] {
  return [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))]
}

export async function loadFollowUpConfig(env: Record<string, string | undefined> = process.env): Promise<FollowUpConfig> {
  const s = await loadSettings()
  const sendOk = env.VERCEL_ENV === 'production' && !envSendOff(env) && !s.readFailed && !s.invalidKeys.includes('followups.sendEnabled') && s.get('followups.sendEnabled') === 1
  return {
    sendEnabled: sendOk,
    draftEnabled: s.get('followups.draftEnabled') === 1,
    draftCrews: parseList(s.get('followups.draftCrews')),
    maxPerDay: s.get('followups.maxPerDay'),
    quietStartHour: s.get('followups.quietStartHour'),
    quietEndHour: s.get('followups.quietEndHour'),
    escalationDiscordIds: parseList(s.get('followups.escalationDiscordIds')),
    footerTelegram: s.get('followups.footerTelegram'),
    footerDiscord: s.get('followups.footerDiscord'),
    maxAlertsPerDay: s.get('followups.maxAlertsPerDay'),
    approvalMaxDays: s.get('followups.approvalMaxDays'),
    unknownTzStartHour: s.get('followups.unknownTzStartHour'),
    unknownTzEndHour: s.get('followups.unknownTzEndHour'),
    telegramDmEnabled: sendOk && resolveToggle('telegram.dmEnabled', s, env),
    dmRecheckDays: s.get('telegram.dmRecheckDays'),
    dmRecheckMaxDays: s.get('telegram.dmRecheckMaxDays'),
    linkTtlDays: s.get('followups.linkTtlDays'),
    snoozeDays: s.get('followups.snoozeDays'),
  }
}

export function appUrl(env: Record<string, string | undefined> = process.env): string {
  return (env.NEXT_PUBLIC_APP_URL?.trim() || 'https://app.pizzadao.org').replace(/\/$/, '')
}
