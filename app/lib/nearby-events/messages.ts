/**
 * The text and buttons of a nearby-event invite. The date is written in the EVENT's timezone (the one the
 * host chose), and says which zone, so it reads the same on Discord and Telegram. Every Discord DM carries a
 * one-tap "Stop" button (custom id `rm:stop:nearby`, handled by discord-interactions/reminders.ts).
 */
import { validTimezone } from '@/app/lib/followups/quiet-hours'

export const STOP_NEARBY_ID = 'rm:stop:nearby'

const NAME_MAX = 100
const clip = (s: string) => (s.length > NAME_MAX ? `${s.slice(0, NAME_MAX - 1)}…` : s)

/** "Sat, Dec 5, 6:00 PM EST" in the event's own zone (UTC when it has none). */
export function eventWhen(startsAt: Date, timezone: string | null): string {
  const tz = validTimezone(timezone)
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(startsAt)
}

/** The RSVP link with the attribution tag. */
export function rsvpUrl(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}ref=pizzadao`
}

export function nearbyText(o: { name: string; startsAt: Date; timezone: string | null; km: number; city: string; url: string }): string {
  const km = Math.max(1, Math.round(o.km))
  return `🍕 Pizza party near you: ${clip(o.name)}, ${eventWhen(o.startsAt, o.timezone)}, about ${km} km from ${o.city}.\nRSVP: ${rsvpUrl(o.url)}`
}

export function nearbyComponents(url: string, settingsUrl: string | null): unknown[] {
  const buttons: unknown[] = [
    { type: 2, style: 5, label: 'RSVP', url: rsvpUrl(url) },
    { type: 2, style: 2, label: 'Not interested in nearby events', custom_id: STOP_NEARBY_ID },
  ]
  if (settingsUrl) buttons.push({ type: 2, style: 5, label: 'Settings', url: settingsUrl })
  return [{ type: 1, components: buttons }]
}

export function nearbyTelegramButtons(url: string, settingsUrl: string | null, optOutUrl: string | null = null): Array<Array<{ text: string; url: string }>> {
  const rows = [[{ text: 'RSVP', url: rsvpUrl(url) }]]
  // The signed link works without a login; the settings page is the fallback.
  const off = optOutUrl ?? settingsUrl
  if (off) rows.push([{ text: 'Not interested in nearby events', url: off }])
  return rows
}
