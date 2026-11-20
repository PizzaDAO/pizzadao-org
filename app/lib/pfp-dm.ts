/**
 * Discord DMs about the PFP: "unlocked" (first time a member reaches the PFP level, once ever) and
 * "ready" (a portrait or dress-up finished, at most one per member per 10 minutes). Each is behind
 * its own setting (default off) and sends only on production with the bot configured. A failure
 * (closed DMs, Discord down) is logged and swallowed: it never breaks the request or the level-up.
 */
import { prisma } from '@/app/lib/db'
import { appBaseUrl } from '@/app/lib/referral-link'
import { toggleEnabled } from '@/app/lib/settings/toggles'
import { checkKeyedRateLimit } from '@/app/lib/rate-limit'
import { deliverDm, reminderSendAllowed } from '@/app/lib/reminders/deliver'
import { fetchMemberIdByDiscordId } from '@/app/lib/sheets/member-repository'
import { loadEditAccess } from '@/app/lib/pfp-assets/access'
import { getSetting } from '@/app/lib/settings'

const pfpLink = (memberId: string) => `${appBaseUrl()}/profile/${encodeURIComponent(memberId)}/pfp`

export const unlockedDmText = (link: string, level: number) =>
  `You reached level ${level} 🍕 You can now make your PizzaDAO PFP: ${link}`
export const readyDmText = (link: string) =>
  `Your PizzaDAO PFP is ready: ${link} Download it to use on Discord.`

/** The durable once-only marker is an in-app notification row (also what the member sees in the bell). */
const UNLOCK_KIND = 'pfp_unlocked_dm'

/**
 * Call right after a completed level is paid. DMs only when that level is the PFP minimum level, and
 * only once per member ever (the marker row is written before sending, so a failed DM is not retried).
 */
export async function maybeSendPfpUnlockedDm(discordId: string, paidLevel: number): Promise<void> {
  try {
    if (!reminderSendAllowed()) return
    if (!(await toggleEnabled('pfp.unlockedDmEnabled'))) return
    const minLevel = await getSetting('pfp.minCompletedLevel').catch(() => 2)
    if (minLevel < 1 || paidLevel !== minLevel) return
    const seen = await prisma.notification.findFirst({
      where: { recipientId: discordId, type: 'LEVEL_COMPLETED', metadata: { path: ['kind'], equals: UNLOCK_KIND } },
      select: { id: true },
    })
    if (seen) return
    const memberId = await fetchMemberIdByDiscordId(discordId).catch(() => null)
    if (!memberId) return
    const link = pfpLink(memberId)
    await prisma.notification.create({
      data: {
        type: 'LEVEL_COMPLETED',
        recipientId: discordId,
        title: 'PFP unlocked',
        message: `You reached level ${paidLevel}. You can now make your PizzaDAO PFP.`,
        metadata: { kind: UNLOCK_KIND, level: paidLevel },
        linkUrl: `/profile/${memberId}/pfp`,
      },
    })
    const out = await deliverDm({ discordId, text: unlockedDmText(link, paidLevel) })
    if (out.kind !== 'sent') console.warn('[pfp-dm] unlocked DM not delivered:', out.kind)
  } catch (e) {
    console.error('[pfp-dm] unlocked DM failed:', e instanceof Error ? e.message : e)
  }
}

/** Call after a portrait or dress-up succeeded (inside `after()`). Throttled to one per member per 10 minutes. */
export async function maybeSendPfpReadyDm(discordId: string): Promise<void> {
  try {
    if (!reminderSendAllowed()) return
    if (!(await toggleEnabled('pfp.readyDmEnabled'))) return
    // Before the PFP level there is no editor to send them to (the onboarding portrait is generated earlier).
    if (!(await loadEditAccess(discordId)).allowed) return
    const memberId = await fetchMemberIdByDiscordId(discordId).catch(() => null)
    if (!memberId) return
    const rl = await checkKeyedRateLimit('pfp-ready-dm', discordId, undefined, { failClosed: true })
    if (!rl.success) return
    const out = await deliverDm({ discordId, text: readyDmText(pfpLink(memberId)) })
    if (out.kind !== 'sent') console.warn('[pfp-dm] ready DM not delivered:', out.kind)
  } catch (e) {
    console.error('[pfp-dm] ready DM failed:', e instanceof Error ? e.message : e)
  }
}
