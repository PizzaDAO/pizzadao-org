/**
 * The text and buttons of a call reminder. Discord renders <t:unix:R> and <t:unix:t> in the reader's
 * own time zone, so no zone is needed. Every DM carries a Stop button (custom id `rm:stop:calls`,
 * handled by discord-interactions/reminders.ts) and, when the member's page is known, a Settings link.
 */
export const STOP_CALLS_ID = 'rm:stop:calls'

export const unix = (d: Date): number => Math.floor(d.getTime() / 1000)

export function callReminderText(o: { crewLabel: string; startsAt: Date; guildId: string | null; eventId: string }): string {
  const t = unix(o.startsAt)
  const join = o.guildId ? `\nJoin: https://discord.com/events/${o.guildId}/${o.eventId}` : ''
  // "Community Call" already ends in "Call": say "{crew} call starts" once.
  const crew = o.crewLabel.replace(/\s+calls?$/i, '').trim() || o.crewLabel
  return `⏰ ${crew} call starts <t:${t}:R> (<t:${t}:t>).${join}`
}

export function callReminderComponents(settingsUrl: string | null): unknown[] {
  const buttons: unknown[] = [{ type: 2, style: 2, label: 'Stop call reminders', custom_id: STOP_CALLS_ID }]
  if (settingsUrl) buttons.push({ type: 2, style: 5, label: 'Settings', url: settingsUrl })
  return [{ type: 1, components: buttons }]
}

/**
 * The Telegram copy of a call reminder: plain text (Telegram has no per-reader time tags, so the time is
 * UTC) and one URL button to the settings page, where reminders are changed or stopped.
 */
export function callReminderTelegramText(o: { crewLabel: string; startsAt: Date; now: Date; guildId: string | null; eventId: string }): string {
  const mins = Math.max(1, Math.round((o.startsAt.getTime() - o.now.getTime()) / 60_000))
  const hh = String(o.startsAt.getUTCHours()).padStart(2, '0')
  const mm = String(o.startsAt.getUTCMinutes()).padStart(2, '0')
  const join = o.guildId ? `\nJoin: https://discord.com/events/${o.guildId}/${o.eventId}` : ''
  const crew = o.crewLabel.replace(/\s+calls?$/i, '').trim() || o.crewLabel
  return `⏰ ${crew} call starts in about ${mins} min (${hh}:${mm} UTC).${join}`
}

export function callReminderTelegramButtons(settingsUrl: string | null): Array<Array<{ text: string; url: string }>> | undefined {
  return settingsUrl ? [[{ text: 'Change or stop reminders', url: settingsUrl }]] : undefined
}

export const STOP_PROPOSALS_ID = 'rm:stop:proposals'

const TITLE_MAX = 120
const clip = (s: string) => (s.length > TITLE_MAX ? `${s.slice(0, TITLE_MAX - 1)}…` : s)

/**
 * Proposal DMs carry only what every member can already see (title, close time, link), never the amount or
 * the body. The closing text never says "you haven't voted": the server does not know who voted.
 */
export function proposalOpenedText(o: { title: string; closesAt: Date; url: string }): string {
  return `🗳️ New proposal open for voting: ${clip(o.title)}. Closes <t:${unix(o.closesAt)}:F>.\nVote (secret, changeable until close): ${o.url}\nOpen it on the device you'll vote from.`
}

export function proposalClosingText(o: { title: string; closesAt: Date; url: string }): string {
  return `🗳️ Voting on ${clip(o.title)} closes <t:${unix(o.closesAt)}:R>. If you already voted, ignore this.\n${o.url}`
}

export function proposalReminderComponents(settingsUrl: string | null): unknown[] {
  const buttons: unknown[] = [{ type: 2, style: 2, label: 'Stop proposal reminders', custom_id: STOP_PROPOSALS_ID }]
  if (settingsUrl) buttons.push({ type: 2, style: 5, label: 'Settings', url: settingsUrl })
  return [{ type: 1, components: buttons }]
}
