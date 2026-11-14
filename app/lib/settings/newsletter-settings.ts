/**
 * Newsletter consent (plans/monthly-newsletter.md, phase 1): double opt-in emails, the member
 * checkbox, and the sender identity. Kept in its own file so
 * the registry only carries one spread line. Everything is off or empty by default: with no sender
 * address, no newsletter email is ever sent. This file imports only types from ./registry.
 */
import { z } from 'zod'
import type { SettingDef } from './registry'

const ENV_NOTE = 'The matching env var set to off always wins; on preview deploys only the env var counts.'

const toggle = (key: string, label: string, help: string, confirmOn: string): SettingDef<boolean> => ({
  key,
  area: 'newsletter',
  label,
  help: `${help} ${ENV_NOTE}`,
  schema: z.boolean(),
  default: false,
  onReadFailure: { value: false },
  input: { type: 'bool' },
  confirm: (from, to) => (to && !from ? confirmOn : null),
})

const confirmEmailsEnabled = toggle(
  'newsletter.confirmEmailsEnabled',
  'Send newsletter confirmation emails',
  'Website signups get a "confirm your address" email (double opt-in). Off, signups are stored as pending and nothing is sent. Needs a sender address below and RESEND_API_KEY.',
  'Newsletter signups will start receiving a confirmation email.',
)

const memberOptInEnabled = toggle(
  'newsletter.memberOptInEnabled',
  'Show the Monthly newsletter checkbox in member email preferences',
  'Members can tick "Monthly newsletter" (explicit opt-in). Off, the checkbox is hidden and the API ignores it.',
  'Members will be able to subscribe to the newsletter from their email preferences.',
)

const fromName: SettingDef<string> = {
  key: 'newsletter.fromName',
  area: 'newsletter',
  label: 'Newsletter sender name',
  help: 'The display name on newsletter emails (confirmation and, later, issues).',
  schema: z.string().trim().max(80).regex(/^[^<>"\\,;:\r\n]*$/, 'No angle brackets, quotes, backslashes, commas, semicolons, colons or line breaks'),
  default: '',
  onReadFailure: { value: '' },
  input: { type: 'text', maxLength: 80 },
}

const fromAddress: SettingDef<string> = {
  key: 'newsletter.fromAddress',
  area: 'newsletter',
  label: 'Newsletter sender address',
  help: 'The From address on newsletter emails. Its domain must be verified in Resend (the app already sends from a verified email subdomain; use an address on a verified domain). Nothing is seeded in code. Empty: newsletter emails are NOT sent (confirmation emails stay unsent and signups remain pending).',
  schema: z.union([z.literal(''), z.string().trim().email().max(254)]),
  default: '',
  onReadFailure: { value: '' },
  input: { type: 'text', maxLength: 254, placeholder: 'news@example.org' },
}

const replyTo: SettingDef<string> = {
  key: 'newsletter.replyTo',
  area: 'newsletter',
  label: 'Newsletter reply-to address',
  help: 'Where replies to newsletter emails go. Empty: no reply-to header.',
  schema: z.union([z.literal(''), z.string().trim().email().max(254)]),
  default: '',
  onReadFailure: { value: '' },
  input: { type: 'text', maxLength: 254, placeholder: 'team@example.org' },
}

const draftEnabled = toggle(
  'newsletter.draftEnabled',
  'Write newsletter drafts with the AI model',
  'Creating an issue draft asks the model for the intro and polished section text. Off, drafts are assembled from the data only (no model call). Nothing is ever sent by drafting.',
  'Newsletter drafts will be written with the AI model.',
)

const int = (key: string, label: string, help: string, def: number, min: number, max: number, unit?: string): SettingDef<number> => ({
  key,
  area: 'newsletter',
  label,
  help,
  schema: z.number().int().min(min).max(max),
  default: def,
  onReadFailure: 'lastKnownGood',
  input: { type: 'int', min, max, ...(unit ? { unit } : {}) },
})

const flag = (key: string, label: string, help: string, def: boolean): SettingDef<boolean> => ({
  key,
  area: 'newsletter',
  label,
  help: `${help} ${ENV_NOTE}`,
  schema: z.boolean(),
  default: def,
  onReadFailure: { value: def },
  input: { type: 'bool' },
})

const xSpaceEnabled = flag('newsletter.xSpaceEnabled', 'Newsletter: include the X Space invite', 'New drafts get the X Space invite block near the top. The block can still be hidden per issue.', true)
const xSpaceLocalTime: SettingDef<string> = {
  key: 'newsletter.xSpaceLocalTime',
  area: 'newsletter',
  label: 'Newsletter: X Space start time (local)',
  help: 'Local start time in 24-hour HH:MM, in the time zone below.',
  schema: z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM, 24-hour'),
  default: '16:20',
  onReadFailure: { value: '16:20' },
  input: { type: 'text', maxLength: 5, placeholder: '16:20' },
}
const xSpaceTimeZone: SettingDef<string> = {
  key: 'newsletter.xSpaceTimeZone',
  area: 'newsletter',
  label: 'Newsletter: X Space time zone',
  help: 'IANA time zone of the local start time (daylight saving is handled automatically).',
  schema: z.string().trim().max(64).refine((v) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: v })
      return true
    } catch {
      return false
    }
  }, 'Not a valid IANA time zone'),
  default: 'America/New_York',
  onReadFailure: { value: 'America/New_York' },
  input: { type: 'text', maxLength: 64, placeholder: 'America/New_York' },
}
const xSpaceDayOfMonth = int('newsletter.xSpaceDayOfMonth', 'Newsletter: X Space day of the month', 'The Space happens on this day every month. An issue dated that day says "today"; any other date shows the date.', 22, 1, 28)
const xProfileUrl: SettingDef<string> = {
  key: 'newsletter.xProfileUrl',
  area: 'newsletter',
  label: 'Newsletter: X profile URL',
  help: 'Used as the X Space link when an issue has no Space URL of its own. Empty: the invite has no link until one is pasted on the issue.',
  schema: z.union([z.literal(''), z.string().trim().max(200).refine((v) => /^https:\/\/(x|twitter)\.com\//i.test(v), 'Use a full https://x.com/... address')]),
  default: '',
  onReadFailure: { value: '' },
  input: { type: 'url', maxLength: 200 },
}
const approverRoleIds: SettingDef<string[]> = {
  key: 'newsletter.approverRoleIds',
  area: 'newsletter',
  label: 'Newsletter approver roles',
  help: 'Members holding one of these Discord roles may approve a newsletter issue. Empty: app admins only. Unreadable settings: nobody can approve. Checked against the server when saved.',
  schema: z.array(z.string().regex(/^\d{15,25}$/, 'Not a Discord id')).max(10),
  default: [],
  onReadFailure: 'lastKnownGood',
  input: { type: 'roleList' },
}
const draftModel: SettingDef<string> = {
  key: 'newsletter.draftModel',
  area: 'newsletter',
  label: 'Newsletter draft model',
  help: 'AI Gateway model id (provider/model) used to write drafts. Empty uses the call summary model.',
  schema: z.string().trim().max(120),
  default: '',
  onReadFailure: 'lastKnownGood',
  input: { type: 'text', maxLength: 120, placeholder: 'provider/model' },
}
const promptExtra: SettingDef<string> = {
  key: 'newsletter.promptExtra',
  area: 'newsletter',
  label: 'Newsletter draft instructions (private)',
  help: 'Extra instructions added after the built-in drafting rules. Never shown again after saving (the page only says set or not set); saving replaces it, reset clears it. If it cannot be read, drafting fails rather than running without it.',
  schema: z.string().trim().max(2000),
  default: '',
  onReadFailure: 'throw',
  input: { type: 'text', maxLength: 2000, multiline: true },
  private: true,
}
const articlesWindowDays = int('newsletter.articlesWindowDays', 'Newsletter: articles window (first issue)', 'With no earlier sent issue, articles published within this many days are considered.', 31, 1, 120, 'days')
const articlesMax = int('newsletter.articlesMax', 'Newsletter: most articles per issue', 'The New articles section lists at most this many, newest first.', 5, 1, 12)
const eventsWindowDays = int('newsletter.eventsWindowDays', 'Newsletter: events window', 'Upcoming Events lists scheduled events starting within this many days of the issue date.', 45, 1, 120, 'days')
const maxCallCrews = int('newsletter.maxCallCrews', 'Newsletter: most crews in Call updates', 'Crews with the most published calls come first; the rest are left out.', 8, 1, 20)
const callOwnerNames = flag('newsletter.callOwnerNames', 'Newsletter: name the people who finished items', 'Call updates may name the person who finished an action item. Off: crew-level text only. Names pass the same blocked-term filter as recaps.', true)

export const NEWSLETTER_SETTINGS = {
  'newsletter.confirmEmailsEnabled': confirmEmailsEnabled,
  'newsletter.memberOptInEnabled': memberOptInEnabled,
  'newsletter.fromName': fromName,
  'newsletter.fromAddress': fromAddress,
  'newsletter.replyTo': replyTo,
  'newsletter.draftEnabled': draftEnabled,
  'newsletter.xSpaceEnabled': xSpaceEnabled,
  'newsletter.xSpaceLocalTime': xSpaceLocalTime,
  'newsletter.xSpaceTimeZone': xSpaceTimeZone,
  'newsletter.xSpaceDayOfMonth': xSpaceDayOfMonth,
  'newsletter.xProfileUrl': xProfileUrl,
  'newsletter.approverRoleIds': approverRoleIds,
  'newsletter.draftModel': draftModel,
  'newsletter.promptExtra': promptExtra,
  'newsletter.articlesWindowDays': articlesWindowDays,
  'newsletter.articlesMax': articlesMax,
  'newsletter.eventsWindowDays': eventsWindowDays,
  'newsletter.maxCallCrews': maxCallCrews,
  'newsletter.callOwnerNames': callOwnerNames,
} as const satisfies Record<string, SettingDef>
