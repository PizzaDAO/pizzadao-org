/**
 * Messages to the approvers: escalation when someone cannot be reached, and alerts for replies and
 * "need help" taps. Contacts come from the followups.escalationDiscordIds setting; when that is
 * empty, from the Dread Pizza Roberts holders who linked Telegram (nobody is hard-coded). Telegram
 * (over the rsv.pizza proxy, same reach rules as follow-ups) is preferred, a Discord DM is the fallback. Nothing goes out unless sending is enabled.
 */
import { prisma } from '@/app/lib/db'
import { getMembersWithRoles } from '@/app/lib/discord'
import { DREAD_PIZZA_ROBERTS_ROLE_ID } from '@/app/ui/constants'
import { loadFollowUpConfig, type FollowUpConfig } from './config'
import { sendDiscordDm } from './discord-dm'
import { loadReach, recordResult, telegramEligibility, type ReachRow, type RecheckCfg } from '@/app/lib/telegram/reach'
import { sendDm, telegramSendAllowed, type DmFailureCode, type DmResult } from '@/app/lib/telegram/rsv-client'

export const MAX_CONTACTS = 5

export interface Contact {
  discordId: string
  telegramChatId: string | null
}

export interface ContactDeps {
  roleHolders: () => Promise<string[]>
  accounts: (discordIds: string[]) => Promise<Array<{ discordId: string; telegramId: string; reach: ReachRow | null }>>
}

const realDeps: ContactDeps = {
  roleHolders: () => getMembersWithRoles([DREAD_PIZZA_ROBERTS_ROLE_ID]),
  accounts: async (ids) => {
    const accounts = await prisma.telegramAccount.findMany({ where: { discordId: { in: ids } }, select: { discordId: true, telegramId: true } })
    return Promise.all(accounts.map(async (a) => ({ ...a, reach: await loadReach(a.telegramId) })))
  },
}

export async function resolveContacts(cfg: Pick<FollowUpConfig, 'escalationDiscordIds' | 'telegramDmEnabled'>, deps: ContactDeps = realDeps): Promise<Contact[]> {
  const configured = cfg.escalationDiscordIds.length > 0
  const ids = configured ? cfg.escalationDiscordIds : await deps.roleHolders().catch(() => [] as string[])
  if (ids.length === 0) return []
  const accounts = new Map((await deps.accounts(ids)).map((a) => [a.discordId, a]))
  const now = new Date()
  const all: Contact[] = ids.map((discordId) => {
    const a = accounts.get(discordId)
    // No buttons on these messages, so the link secret does not matter here.
    const ok = telegramEligibility({ toggleOn: cfg.telegramDmEnabled, senderAllowed: telegramSendAllowed(), linkSecretSet: true, telegramId: a?.telegramId ?? null, reach: a?.reach ?? null, now }).eligible
    return { discordId, telegramChatId: ok && a ? a.telegramId : null }
  })
  if (configured) return all
  // Default list: the approvers who linked Telegram; with none, fall back to their Discord DMs.
  const withTelegram = all.filter((c) => c.telegramChatId)
  return withTelegram.length > 0 ? withTelegram : all
}

export interface DeliverDeps {
  telegram: (a: { telegramUserId: string; text: string; idempotencyKey: string }) => Promise<DmResult>
  discord: typeof sendDiscordDm
  recordReach: (telegramId: string, code: DmFailureCode | 'ok', cfg: RecheckCfg) => Promise<void>
}

const realDeliver: DeliverDeps = { telegram: (a) => sendDm(a), discord: sendDiscordDm, recordReach: (id, code, cfg) => recordResult(id, code, cfg) }

/** Send `text` to each contact (Telegram, else Discord). Returns how many received it. */
export async function deliverToContacts(contacts: Contact[], text: string, cfg: RecheckCfg, deps: DeliverDeps = realDeliver): Promise<number> {
  let delivered = 0
  for (const c of contacts) {
    try {
      if (c.telegramChatId) {
        const r = await deps.telegram({ telegramUserId: c.telegramChatId, text, idempotencyKey: `ap:${c.telegramChatId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}` })
        if (r.ok) {
          delivered++
          continue
        }
        if (r.code === 'uncertain') throw new Error('telegram: send failed') // may have been delivered: no Discord copy
        if (r.code === 'not_started' || r.code === 'blocked') await deps.recordReach(c.telegramChatId, r.code, cfg).catch(() => {})
        // Anything else sent nothing: fall through to Discord.
      }
      await deps.discord(c.discordId, text)
      delivered++
    } catch (e) {
      console.warn('[followups] could not reach an approver:', e instanceof Error ? e.message.slice(0, 120) : 'error')
    }
  }
  return delivered
}

/** Tell the approvers something (a reply, a help request). No-op while sending is off. */
export async function notifyApprovers(text: string): Promise<number> {
  const cfg = await loadFollowUpConfig()
  if (!cfg.sendEnabled) return 0
  // Bounded: at most a handful of approvers, one short message each.
  return deliverToContacts((await resolveContacts(cfg)).slice(0, MAX_CONTACTS), text.slice(0, 1800), cfg)
}
