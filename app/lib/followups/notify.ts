/**
 * Messages to the approvers: escalation when someone cannot be reached, and alerts for replies and
 * "need help" taps. Contacts come from the followups.escalationDiscordIds setting; when that is
 * empty, from the Dread Pizza Roberts holders who linked Telegram (nobody is hard-coded). Telegram
 * is preferred, a Discord DM is the fallback. Nothing goes out unless sending is enabled.
 */
import { prisma } from '@/app/lib/db'
import { getMembersWithRoles } from '@/app/lib/discord'
import { DREAD_PIZZA_ROBERTS_ROLE_ID } from '@/app/ui/constants'
import { loadFollowUpConfig, type FollowUpConfig } from './config'
import { sendDiscordDm } from './discord-dm'
import { cannotMessage, sendTelegramMessage, telegramSenderAvailable } from './telegram'
import { setDmAllowed } from './store'

export const MAX_CONTACTS = 5

export interface Contact {
  discordId: string
  telegramChatId: string | null
}

export interface ContactDeps {
  roleHolders: () => Promise<string[]>
  accounts: (discordIds: string[]) => Promise<Array<{ discordId: string; telegramId: string; dmAllowed: boolean }>>
}

const realDeps: ContactDeps = {
  roleHolders: () => getMembersWithRoles([DREAD_PIZZA_ROBERTS_ROLE_ID]),
  accounts: (ids) => prisma.telegramAccount.findMany({ where: { discordId: { in: ids } }, select: { discordId: true, telegramId: true, dmAllowed: true } }),
}

export async function resolveContacts(cfg: Pick<FollowUpConfig, 'escalationDiscordIds'>, deps: ContactDeps = realDeps): Promise<Contact[]> {
  const configured = cfg.escalationDiscordIds.length > 0
  const ids = configured ? cfg.escalationDiscordIds : await deps.roleHolders().catch(() => [] as string[])
  if (ids.length === 0) return []
  const accounts = new Map((await deps.accounts(ids)).map((a) => [a.discordId, a]))
  const all: Contact[] = ids.map((discordId) => {
    const a = accounts.get(discordId)
    return { discordId, telegramChatId: telegramSenderAvailable() && a?.dmAllowed ? a.telegramId : null }
  })
  if (configured) return all
  // Default list: the approvers who linked Telegram; with none, fall back to their Discord DMs.
  const withTelegram = all.filter((c) => c.telegramChatId)
  return withTelegram.length > 0 ? withTelegram : all
}

export interface DeliverDeps {
  telegram: typeof sendTelegramMessage
  discord: typeof sendDiscordDm
  markNoDm: (telegramId: string) => Promise<void>
}

const realDeliver: DeliverDeps = { telegram: sendTelegramMessage, discord: sendDiscordDm, markNoDm: (id) => setDmAllowed(id, false) }

/** Send `text` to each contact (Telegram, else Discord). Returns how many received it. */
export async function deliverToContacts(contacts: Contact[], text: string, deps: DeliverDeps = realDeliver): Promise<number> {
  let delivered = 0
  for (const c of contacts) {
    try {
      if (c.telegramChatId) {
        try {
          await deps.telegram(c.telegramChatId, text)
          delivered++
          continue
        } catch (e) {
          if (!cannotMessage(e)) throw e
          await deps.markNoDm(c.telegramChatId).catch(() => {})
        }
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
  return deliverToContacts((await resolveContacts(cfg)).slice(0, MAX_CONTACTS), text.slice(0, 1800))
}
