/**
 * Events attended on member profiles (plans/profile-events-attended.md). Its own file so the registry
 * only carries one spread line. Imports only types from ./registry.
 */
import { z } from 'zod'
import type { SettingDef } from './registry'

const enabled: SettingDef<number> = {
  key: 'profile.eventsAttended.enabled',
  area: 'members',
  label: 'Events attended on profiles on (1) or off (0)',
  help: 'Shows an "Events attended" section on member profiles (rsv.pizza check-ins, Unlock tickets, Bitcoin Pizza Day host missions) and runs the nightly rsv.pizza refresh. Off by default. The EVENTS_ATTENDED_ENABLED=off environment variable forces it off whatever this says.',
  schema: z.number().int().min(0).max(1),
  default: 0,
  onReadFailure: { value: 0 },
  input: { type: 'int', min: 0, max: 1 },
}

const countTickets: SettingDef<number> = {
  key: 'profile.eventsAttended.countTickets',
  area: 'members',
  label: 'Show Unlock tickets as events (1) or not (0)',
  help: 'Tickets are an RSVP, not proof of attendance, so they carry a "Ticket" badge. A ticket for a party the member also checked in to is merged into that row.',
  schema: z.number().int().min(0).max(1),
  default: 1,
  onReadFailure: { value: 1 },
  input: { type: 'int', min: 0, max: 1 },
}

const rsvRecheckDays: SettingDef<number> = {
  key: 'profile.eventsAttended.rsvRecheckDays',
  area: 'members',
  label: 'rsv.pizza re-check interval (days)',
  help: 'The nightly job asks rsv.pizza again about a member whose last check is older than this. Verifying or changing an email, linking a wallet, or linking or unlinking an rsv.pizza account re-checks at once.',
  schema: z.number().int().min(1).max(90),
  default: 7,
  onReadFailure: { value: 7 },
  input: { type: 'int', min: 1, max: 90, unit: 'days' },
}

const httpsUrl = (max = 300) => z.string().trim().max(max).refine((v) => /^https:\/\/[^\s]+$/.test(v), 'Use an https:// URL')

const rsvLinkUrl: SettingDef<string> = {
  key: 'profile.eventsAttended.rsvLinkUrl',
  area: 'members',
  label: 'rsv.pizza account-link page',
  help: 'Where "Link rsv.pizza account" sends the member to sign in on rsv.pizza (we add the return and state parameters).',
  schema: httpsUrl(),
  default: 'https://rsv.pizza/link/pizzadao',
  onReadFailure: { value: 'https://rsv.pizza/link/pizzadao' },
  input: { type: 'text', maxLength: 300, placeholder: 'https://rsv.pizza/link/pizzadao' },
}

const rsvApiUrl: SettingDef<string> = {
  key: 'profile.eventsAttended.rsvApiUrl',
  area: 'members',
  label: 'rsv.pizza API base URL',
  help: 'Base URL for the guest-attendance lookup (POST /api/service/guest-attendance). The RSV_PIZZA_API_URL environment variable, when set, wins (previews). The service key stays an environment variable.',
  schema: httpsUrl(),
  default: 'https://api.rsv.pizza',
  onReadFailure: { value: 'https://api.rsv.pizza' },
  input: { type: 'text', maxLength: 300, placeholder: 'https://api.rsv.pizza' },
}

const rsvJwksUrl: SettingDef<string> = {
  key: 'profile.eventsAttended.rsvJwksUrl',
  area: 'members',
  label: 'rsv.pizza link-token key set (JWKS URL)',
  help: 'The public keys that sign the account-link token (ES256). Cached for about five minutes.',
  schema: httpsUrl(),
  default: 'https://api.rsv.pizza/.well-known/jwks.json',
  onReadFailure: { value: 'https://api.rsv.pizza/.well-known/jwks.json' },
  input: { type: 'text', maxLength: 300, placeholder: 'https://api.rsv.pizza/.well-known/jwks.json' },
}

const rsvLinkIssuer: SettingDef<string> = {
  key: 'profile.eventsAttended.rsvLinkIssuer',
  area: 'members',
  label: 'rsv.pizza link-token issuer (iss)',
  help: 'The link token must carry exactly this issuer.',
  schema: z.string().trim().min(1).max(300),
  default: 'https://api.rsv.pizza',
  onReadFailure: { value: 'https://api.rsv.pizza' },
  input: { type: 'text', maxLength: 300 },
}

const rsvLinkAudience: SettingDef<string> = {
  key: 'profile.eventsAttended.rsvLinkAudience',
  area: 'members',
  label: 'rsv.pizza link-token audience (aud)',
  help: 'The link token must be minted for this audience. Change it on a preview whose rsv.pizza side uses another audience.',
  schema: z.string().trim().min(1).max(300),
  default: 'pizzadao.org',
  onReadFailure: { value: 'pizzadao.org' },
  input: { type: 'text', maxLength: 300 },
}

export const EVENTS_ATTENDED_SETTINGS = {
  'profile.eventsAttended.enabled': enabled,
  'profile.eventsAttended.countTickets': countTickets,
  'profile.eventsAttended.rsvRecheckDays': rsvRecheckDays,
  'profile.eventsAttended.rsvLinkUrl': rsvLinkUrl,
  'profile.eventsAttended.rsvApiUrl': rsvApiUrl,
  'profile.eventsAttended.rsvJwksUrl': rsvJwksUrl,
  'profile.eventsAttended.rsvLinkIssuer': rsvLinkIssuer,
  'profile.eventsAttended.rsvLinkAudience': rsvLinkAudience,
} as const satisfies Record<string, SettingDef>
