/**
 * Member name reminders (admin-triggered DMs to members whose display name is not themed). Kept in
 * its own file so the registry only carries one spread line. This file imports only types from ./registry.
 */
import { z } from 'zod'
import type { SettingDef } from './registry'
import { SITE_URL } from '@/app/lib/site-url'

export const DEFAULT_NAME_REMINDER_TEXT = `You haven't claimed your pizza mafia name yet! Claim it at ${SITE_URL}`

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

const discordActivityShow: SettingDef<boolean> = {
  key: 'members.discordActivityShow',
  area: 'members',
  label: 'Show Discord activity on profiles',
  help: 'Shows a "Discord activity" block (message count, active since, last active, active months and the most-used public channels) on member profiles and the hover card. Dates are shown to the month only; channels only if they are public (see the public-channel roles setting). Off hides the block everywhere.',
  schema: z.boolean(),
  default: true,
  onReadFailure: { value: true },
  input: { type: 'bool' },
}

const discordActivityCount: SettingDef<boolean> = {
  key: 'members.discordActivityCount',
  area: 'members',
  label: 'Count Discord messages live',
  help: 'The recorder bot counts each non-bot message in the server (no message content is read or stored) and sends the totals to the app in batches, keeping the per-member activity numbers fresh. Off stops counting; existing numbers stay.',
  schema: z.boolean(),
  default: true,
  onReadFailure: { value: true },
  input: { type: 'bool' },
}

const discordActivityPublicRoleIds: SettingDef<string> = {
  key: 'members.discordActivityPublicRoleIds',
  area: 'members',
  label: 'Discord activity: public-channel roles',
  help: 'One Discord role id per line: the role every verified member has. A channel counts as public (its name can show in a profile\'s top channels) if @everyone OR any of these roles can view it. Needed when @everyone cannot see channels and a base verified-member role is granted access instead. Empty means only channels @everyone can see. Takes effect within an hour.',
  schema: z.string().max(500).refine((v) => v.split('\n').every((l) => l.trim() === '' || /^\d{15,25}$/.test(l.trim())), 'Use one numeric role id per line'),
  default: '',
  onReadFailure: { value: '' },
  input: { type: 'text', multiline: true, maxLength: 500, placeholder: '123456789012345678' },
}

const discordActivityFlushSeconds: SettingDef<number> = {
  key: 'members.discordActivityFlushSeconds',
  area: 'members',
  label: 'Discord activity batch interval (seconds)',
  help: 'How often the recorder sends the message counts it has gathered. A restart can lose up to this much counting.',
  schema: z.number().int().min(60).max(3600),
  default: 300,
  onReadFailure: { value: 300 },
  input: { type: 'int', min: 60, max: 3600, unit: 'seconds' },
}

export const MEMBERS_SETTINGS = {
  'members.discordActivityShow': discordActivityShow,
  'members.discordActivityCount': discordActivityCount,
  'members.discordActivityPublicRoleIds': discordActivityPublicRoleIds,
  'members.discordActivityFlushSeconds': discordActivityFlushSeconds,
  'members.nameReminderText': nameReminderText,
  'members.nameReminderCooldownDays': nameReminderCooldownDays,
} as const satisfies Record<string, SettingDef>
