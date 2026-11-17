/**
 * Events attended configuration. The on/off switch is the DB setting `profile.eventsAttended.enabled`
 * (default off); the env var EVENTS_ATTENDED_ENABLED is only a kill switch: "off" (or 0/false) wins.
 */
import { loadSettings } from '@/app/lib/settings'

export interface EventsAttendedConfig {
  enabled: boolean
  countTickets: boolean
  rsvRecheckDays: number
  rsvLinkUrl: string
  rsvApiUrl: string
  rsvJwksUrl: string
  rsvLinkIssuer: string
  rsvLinkAudience: string
}

export function killSwitchOn(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.EVENTS_ATTENDED_ENABLED?.trim().toLowerCase()
  return v === 'off' || v === '0' || v === 'false'
}

export async function loadEventsAttendedConfig(env: NodeJS.ProcessEnv = process.env): Promise<EventsAttendedConfig> {
  const s = await loadSettings()
  return {
    enabled: !killSwitchOn(env) && !s.readFailed && s.get('profile.eventsAttended.enabled') === 1,
    countTickets: s.get('profile.eventsAttended.countTickets') === 1,
    rsvRecheckDays: s.get('profile.eventsAttended.rsvRecheckDays'),
    rsvLinkUrl: s.get('profile.eventsAttended.rsvLinkUrl'),
    // The env var wins so a preview can point at another rsv.pizza.
    rsvApiUrl: (env.RSV_PIZZA_API_URL?.trim() || s.get('profile.eventsAttended.rsvApiUrl')).replace(/\/+$/, ''),
    rsvJwksUrl: s.get('profile.eventsAttended.rsvJwksUrl'),
    rsvLinkIssuer: s.get('profile.eventsAttended.rsvLinkIssuer'),
    rsvLinkAudience: s.get('profile.eventsAttended.rsvLinkAudience'),
  }
}
