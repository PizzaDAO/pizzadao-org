/**
 * Member name reminders (admin-triggered DMs to members whose display name is not themed). Kept in
 * its own file so the registry only carries one spread line. This file imports only types from ./registry.
 */
import { z } from 'zod'
import type { SettingDef } from './registry'

export const DEFAULT_NAME_REMINDER_TEXT = "You haven't claimed your pizza mafia name yet! Claim it at https://app.pizzadao.org"

const nameReminderText: SettingDef<string> = {
  key: 'members.nameReminderText',
  area: 'members',
  label: 'Name reminder DM text',
  help: 'The DM an admin can send from /admin/members/names to members whose display name is not pizza or mafia themed. Plain text, no mentions. Nothing is sent automatically.',
  schema: z.string().trim().min(1).max(1500),
  default: DEFAULT_NAME_REMINDER_TEXT,
  onReadFailure: { value: DEFAULT_NAME_REMINDER_TEXT },
  input: { type: 'text', multiline: true, maxLength: 1500 },
}

const nameReminderCooldownDays: SettingDef<number> = {
  key: 'members.nameReminderCooldownDays',
  area: 'members',
  label: 'Name reminder cooldown (days)',
  help: 'A member is sent at most one name reminder in this many days; the report marks them as reminded and skips them.',
  schema: z.number().int().min(1).max(365),
  default: 30,
  onReadFailure: { value: 30 },
  input: { type: 'int', min: 1, max: 365, unit: 'days' },
}

export const MEMBERS_SETTINGS = {
  'members.nameReminderText': nameReminderText,
  'members.nameReminderCooldownDays': nameReminderCooldownDays,
} as const satisfies Record<string, SettingDef>
