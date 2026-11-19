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

const warmEnabled: SettingDef<boolean> = {
  key: 'members.warmEnabled',
  area: 'members',
  label: 'Keep the site warm (5-minute prewarm)',
  help: 'Every 5 minutes a job requests the home page, the pages below and a few member profiles over the public URL so they stay fast for visitors (no cold start). It only reads pages, never writes anything. Off stops it.',
  schema: z.boolean(),
  default: true,
  onReadFailure: { value: false },
  input: { type: 'bool' },
}

const warmProfileIds: SettingDef<string> = {
  key: 'members.warmProfileIds',
  area: 'members',
  label: 'Prewarm: member ids',
  help: 'One member id per line (digits only, at most 10): the profile pages (and their data) the prewarm job requests. Any existing member id works for warming the profile code; pick a few popular ones.',
  schema: z.string().max(200).refine((v) => v.split('\n').every((l) => l.trim() === '' || /^\d{1,10}$/.test(l.trim())), 'Use one numeric member id per line'),
  default: '1\n2\n3',
  onReadFailure: { value: '' },
  input: { type: 'text', multiline: true, maxLength: 200, placeholder: '1' },
}

const warmPaths: SettingDef<string> = {
  key: 'members.warmPaths',
  area: 'members',
  label: 'Prewarm: pages',
  help: 'One site path per line (starting with /, at most 20), requested by the prewarm job in addition to the member profiles, for example / or /missions.',
  schema: z.string().max(1000).refine((v) => v.split('\n').every((l) => l.trim() === '' || /^\/(?!\/)\S*$/.test(l.trim())), 'Use one path per line, starting with /'),
  default: '/\n/missions',
  onReadFailure: { value: '' },
  input: { type: 'text', multiline: true, maxLength: 1000, placeholder: '/missions' },
}

const walletsRequireSignature: SettingDef<boolean> = {
  key: 'wallets.requireSignature',
  area: 'members',
  label: 'Require a wallet signature to add an EVM wallet',
  help: 'On: a member must sign a free message (no gas) with a new EVM wallet to prove it is theirs before it is saved; pasting an address is refused. Off: a wallet can be added without a signature, as before. Wallets already saved are never affected. Solana wallets are not checked. The WALLETS_REQUIRE_SIGNATURE env var set to off always wins; on preview deploys only the env var counts (set it to true there to test).',
  schema: z.boolean(),
  default: false,
  onReadFailure: { value: false },
  input: { type: 'bool' },
  confirm: (from, to) => (to && !from ? 'New EVM wallets will need a signed message to be added.' : null),
}

export const MEMBERS_SETTINGS = {
  'wallets.requireSignature': walletsRequireSignature,
  'members.discordActivityShow': discordActivityShow,
  'members.discordActivityCount': discordActivityCount,
  'members.discordActivityPublicRoleIds': discordActivityPublicRoleIds,
  'members.discordActivityFlushSeconds': discordActivityFlushSeconds,
  'members.warmEnabled': warmEnabled,
  'members.warmProfileIds': warmProfileIds,
  'members.warmPaths': warmPaths,
  'members.nameReminderText': nameReminderText,
  'members.nameReminderCooldownDays': nameReminderCooldownDays,
} as const satisfies Record<string, SettingDef>
