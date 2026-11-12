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
  label: 'Call reminders by Discord DM',
  help: 'Send a short DM before each call to members who opted in on their profile page (Community Call, or also their crews). Each DM has a Stop button. Off: nothing is sent and the scheduler only logs what it would send. The REMINDERS_CALLS_ENABLED env var set to off always wins; previews never send.',
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

export const REMINDERS_SETTINGS = {
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
    help: 'How long before a call the DM goes out. The scheduler runs every 5 minutes, so it lands up to 5 minutes later than this. A call closer than 5 minutes away is skipped: too late is worse than none.',
    min: 10,
    max: 1440,
    default: 60,
    unit: 'min',
  }),
  'reminders.maxSendsPerRun': int({
    key: 'reminders.maxSendsPerRun',
    label: 'Most reminders per scheduler run',
    help: 'Caps one 5-minute run. The rest wait for the next run (a call reminder is only due for a limited time).',
    min: 1,
    max: 200,
    default: 40,
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
