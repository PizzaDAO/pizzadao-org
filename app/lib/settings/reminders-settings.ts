/**
 * Reminders by DM (plans/voting-golive-and-reminders.md Part B). Kept in its own file so the registry
 * only carries one spread line for the whole `reminders` group. Phase B1 (calls over Discord DM).
 *
 * Everything defaults to the safe state: the switch is off, and members must opt in one by one.
 * This file imports only types from ./registry (no runtime cycle).
 */
import { z } from 'zod'
import type { SettingDef } from './registry'

function int(o: { key: string; label: string; help: string; min: number; max: number; default: number; unit?: string }): SettingDef<number> {
  return {
    key: o.key,
    area: 'reminders',
    label: o.label,
    help: o.help,
    schema: z.number().int().min(o.min).max(o.max),
    default: o.default,
    // An unreadable value falls back to the cautious default.
    onReadFailure: { value: o.default },
    input: { type: 'int', min: o.min, max: o.max, ...(o.unit ? { unit: o.unit } : {}) },
  }
}

const callsEnabled: SettingDef<boolean> = {
  key: 'reminders.callsEnabled',
  area: 'reminders',
  label: 'Call reminders by DM',
  help: 'Send a short DM, on Discord and/or Telegram as each member chose, before each call to members who opted in on their profile page (Community Call, their crews, and calls they marked Interested on Discord). Discord DMs have a Stop button; Telegram DMs link to the settings page. Off: nothing is sent and the scheduler only logs what it would send. The REMINDERS_CALLS_ENABLED env var set to off always wins; previews never send.',
  schema: z.boolean(),
  default: false,
  onReadFailure: { value: false },
  input: { type: 'bool' },
  confirm: (from, to) => (to && !from ? 'Members who opted in will start getting call reminders by Discord DM.' : null),
}

const proposalsEnabled: SettingDef<boolean> = {
  key: 'reminders.proposalsEnabled',
  area: 'reminders',
  label: 'Proposal reminders by Discord DM',
  help: 'DM members who opted in when a proposal opens, and shortly before it closes (the closing reminder goes only to eligible members who never picked up a ballot token). Needs proposals.enabled too; test proposals go only to pilot testers. Each DM has a Stop button. Off: nothing is sent and the scheduler only logs what it would send. The REMINDERS_PROPOSALS_ENABLED env var set to off always wins; previews never send.',
  schema: z.boolean(),
  default: false,
  onReadFailure: { value: false },
  input: { type: 'bool' },
  confirm: (from, to) => (to && !from ? 'Members who opted in will start getting proposal reminders by Discord DM.' : null),
}

const nearbyEventsEnabled: SettingDef<boolean> = {
  key: 'reminders.nearbyEventsEnabled',
  area: 'reminders',
  label: 'Nearby pizza-party invites',
  help: 'Tell members about curated public pizza parties (Global Pizza Party and approved series) near their city: a DM on their reminder channel (Discord, Telegram or both) plus an in-app notification, with an RSVP link (nobody is RSVPed). Invites are OPT-OUT: once this is on, every member whose city is on the map gets them unless they turned them off (one tap on the DM, or the reminder settings). Capped per member per day and per week, no sends in quiet hours. Off: nothing is sent and the scheduler only counts what it would send. The REMINDERS_NEARBY_EVENTS_ENABLED env var set to off always wins; previews never send.',
  schema: z.boolean(),
  default: false,
  onReadFailure: { value: false },
  input: { type: 'bool' },
  confirm: (from, to) => (to && !from ? 'EVERY member whose city is on the map will start getting nearby-event invites (they can opt out), within the daily and weekly caps.' : null),
}

const nearbyEventKinds: SettingDef<string[]> = {
  key: 'reminders.nearbyEventKinds',
  area: 'reminders',
  label: 'Nearby invites: event kinds',
  help: 'Which curated events may be invited to: gpp (Global Pizza Party) and series (approved or listed series events). One per line.',
  schema: z.array(z.enum(['gpp', 'series'])).max(2),
  default: ['gpp', 'series'],
  onReadFailure: { value: ['gpp', 'series'] },
  input: { type: 'stringList', maxItems: 2, maxLength: 6 },
}

export const REMINDERS_SETTINGS = {
  'reminders.nearbyEventsEnabled': nearbyEventsEnabled,
  'reminders.nearbyEventKinds': nearbyEventKinds,
  'reminders.callsEnabled': callsEnabled,
  'reminders.proposalsEnabled': proposalsEnabled,
  'reminders.proposalClosingHours': int({
    key: 'reminders.proposalClosingHours',
    label: 'Proposal "closing soon" lead time (hours)',
    help: 'How long before a proposal closes the closing reminder goes out. For a window shorter than twice this (a test proposal), it starts halfway through the window.',
    min: 2,
    max: 72,
    default: 24,
    unit: 'h',
  }),
  'reminders.callLeadMinutes': int({
    key: 'reminders.callLeadMinutes',
    label: 'Call reminder lead time (minutes)',
    help: 'The default for members who have not picked their own (5, 10, 15, 30 or 60 minutes on their profile page). The scheduler runs every minute. A call closer than 2 minutes away is skipped: too late is worse than none.',
    min: 5,
    max: 1440,
    default: 60,
    unit: 'min',
  }),
  'reminders.maxSendsPerRun': int({
    key: 'reminders.maxSendsPerRun',
    label: 'Most reminders per scheduler run',
    help: 'Caps one scheduler run (every minute). The rest wait for the next run (a call reminder is only due for a limited time).',
    min: 1,
    max: 200,
    default: 40,
  }),
  'reminders.nearbyDefaultRadiusKm': int({
    key: 'reminders.nearbyDefaultRadiusKm',
    label: 'Nearby invites: default radius (km)',
    help: "How far from a member's city an event may be to invite them, for members who have not picked their own (10 to 250 km on their profile page).",
    min: 5,
    max: 500,
    default: 50,
    unit: 'km',
  }),
  'reminders.nearbyCityLevelSlackKm': int({
    key: 'reminders.nearbyCityLevelSlackKm',
    label: 'Nearby invites: extra reach for city-level events (km)',
    help: 'Added to the radius when the event only has city-centre coordinates (no street address), since the real venue may be further out.',
    min: 0,
    max: 100,
    default: 25,
    unit: 'km',
  }),
  'reminders.nearbyMaxPerWeek': int({
    key: 'reminders.nearbyMaxPerWeek',
    label: 'Nearby invites: most per member per week',
    help: 'Over a rolling 7 days. Further events wait (and are invited to later if still open and in time); they are not all sent at once.',
    min: 1,
    max: 10,
    default: 3,
  }),
  'reminders.nearbyMaxPerDay': int({
    key: 'reminders.nearbyMaxPerDay',
    label: 'Nearby invites: most per member per day',
    help: 'Over a rolling 24 hours.',
    min: 1,
    max: 5,
    default: 1,
  }),
  'reminders.nearbyMinLeadHours': int({
    key: 'reminders.nearbyMinLeadHours',
    label: 'Nearby invites: shortest notice (hours)',
    help: 'No invite for an event starting sooner than this.',
    min: 1,
    max: 168,
    default: 24,
    unit: 'h',
  }),
  'reminders.nearbyMaxLeadDays': int({
    key: 'reminders.nearbyMaxLeadDays',
    label: 'Nearby invites: furthest ahead (days)',
    help: 'No invite for an event starting later than this.',
    min: 1,
    max: 90,
    default: 45,
    unit: 'd',
  }),
  'reminders.nearbyMaxSendsPerRun': int({
    key: 'reminders.nearbyMaxSendsPerRun',
    label: 'Nearby invites: most per scheduler run',
    help: 'The scheduler looks for nearby invites every 30 minutes. The rest wait for the next run.',
    min: 1,
    max: 500,
    default: 100,
  }),
  'reminders.maxPerMemberPerDay': int({
    key: 'reminders.maxPerMemberPerDay',
    label: 'Most reminders per member per day',
    help: 'All reminder kinds together, over a rolling 24 hours.',
    min: 1,
    max: 20,
    default: 6,
  }),
} as const satisfies Record<string, SettingDef>
