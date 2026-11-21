/**
 * Event name tags (plans/marinara-32633.md): the service endpoint rsv.pizza calls to turn hashed guest
 * identifiers into public tag data. Its own file so the registry only carries one spread line.
 * Imports only types from ./registry.
 */
import { z } from 'zod'
import type { SettingDef } from './registry'

const toggle = (key: string, label: string, help: string, def: 0 | 1): SettingDef<number> => ({
  key,
  area: 'members',
  label,
  help,
  schema: z.number().int().min(0).max(1),
  default: def,
  onReadFailure: { value: def },
  input: { type: 'int', min: 0, max: 1 },
})

const enabled = toggle(
  'nametags.enabled',
  'Event name tags on (1) or off (0)',
  'Lets rsv.pizza hosts look up members for printed name tags (POST /api/service/nametag-members). Off by default: the endpoint answers 503 while off. It also needs the NAMETAG_SERVICE_KEY environment variable (the shared key rsv.pizza sends); with no key the endpoint stays closed.',
  0,
)

const matchWallets = toggle(
  'nametags.matchWallets',
  'Match guests by linked wallet (1) or not (0)',
  "Besides a verified profile email or a linked rsv.pizza account, also match a guest whose RSVP wallet is one of the member's linked EVM wallets.",
  1,
)

const maxIdentifiers: SettingDef<number> = {
  key: 'nametags.maxIdentifiers',
  area: 'members',
  label: 'Most identifiers per request',
  help: 'Caps the email hashes and, separately, the wallets in one request. rsv.pizza sends larger guest lists in chunks.',
  schema: z.number().int().min(10).max(5000),
  default: 500,
  onReadFailure: { value: 500 },
  input: { type: 'int', min: 10, max: 5000 },
}

const maxCrews: SettingDef<number> = {
  key: 'nametags.maxCrews',
  area: 'members',
  label: 'Crews printed on a tag',
  help: 'At most this many crews appear on a member tag.',
  schema: z.number().int().min(0).max(6),
  default: 2,
  onReadFailure: { value: 2 },
  input: { type: 'int', min: 0, max: 6 },
}

export const NAMETAG_SETTINGS = {
  'nametags.enabled': enabled,
  'nametags.matchWallets': matchWallets,
  'nametags.maxIdentifiers': maxIdentifiers,
  'nametags.maxCrews': maxCrews,
  'nametags.fields.city': toggle('nametags.fields.city', 'Print city on tags (1) or not (0)', "City is already public on profiles, but some members may not expect it on a badge at someone else's event.", 1),
  'nametags.fields.crews': toggle('nametags.fields.crews', 'Print crews on tags (1) or not (0)', 'Crew labels on the member tag.', 1),
  'nametags.fields.level': toggle('nametags.fields.level', 'Print level on tags (1) or not (0)', 'Highest completed level badge on the member tag.', 1),
} as const satisfies Record<string, SettingDef>
