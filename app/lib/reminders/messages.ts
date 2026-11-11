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
