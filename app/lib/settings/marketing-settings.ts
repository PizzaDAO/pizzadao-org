/**
 * The marketing pages' forms and calendar (plans/pizzadao-org-to-vercel.md, Phase 2): the newsletter
 * signup, the contact and partners form, and the community calendar. Kept in its own file so the
 * registry only carries one spread line.
 *
 * Everything defaults to the safe state: each switch is off (the endpoint answers 503 and the form
 * shows its "try again" message), the team notification address is empty (the message is stored and
 * nothing is emailed) and so is the calendar feed. This file imports only types from ./registry.
 */
import { z } from 'zod'
import type { SettingDef } from './registry'

const toggle = (key: string, label: string, help: string, confirmOn: string): SettingDef<boolean> => ({
  key,
  area: 'marketing',
  label,
  help,
  schema: z.boolean(),
  default: false,
  onReadFailure: { value: false },
  input: { type: 'bool' },
  confirm: (from, to) => (to && !from ? confirmOn : null),
})

const newsletterEnabled = toggle(
  'marketing.newsletterEnabled',
  'Accept newsletter signups from the website',
  'POST /api/public/newsletter stores the address. Off, it answers 503 and the signup form shows its error message. The MARKETING_NEWSLETTER_ENABLED env var set to off always wins; on preview deploys only the env var counts.',
  'The website newsletter forms will start saving email addresses.',
)

const contactEnabled = toggle(
  'marketing.contactEnabled',
  'Accept contact and partnership messages from the website',
  'POST /api/public/contact stores the message (and emails the team when an address is set below). Off, it answers 503 and the form shows its error message. The MARKETING_CONTACT_ENABLED env var set to off always wins; on preview deploys only the env var counts.',
  'The website contact and partners forms will start saving messages.',
)

const calendarEnabled = toggle(
  'marketing.calendarEnabled',
  'Show the community calendar on the website',
  'GET /api/public/calendar reads the public calendar feed below and returns the next 60 days of events. Off, it returns an empty list. The MARKETING_CALENDAR_ENABLED env var set to off always wins; on preview deploys only the env var counts.',
  'The community page will show events from the calendar feed.',
)

const contactNotifyEmail: SettingDef<string> = {
  key: 'marketing.contactNotifyEmail',
  area: 'marketing',
  label: 'Email new website messages to',
  help: 'One address that receives a notification for each contact or partnership message (sent through Resend). Empty: messages are only stored. Needs RESEND_API_KEY.',
  schema: z.union([z.literal(''), z.string().trim().email().max(320)]),
  default: '',
  onReadFailure: { value: '' },
  input: { type: 'text', maxLength: 320, placeholder: 'team@example.org' },
}

const calendarIcsUrl: SettingDef<string> = {
  key: 'marketing.calendarIcsUrl',
  area: 'marketing',
  label: 'Community calendar feed (iCal URL)',
  help: 'The public .ics address of the Google Calendar shown on the community page. Empty: the calendar shows no events. The feed is read at most every 10 minutes.',
  schema: z.union([z.literal(''), z.string().trim().url().max(500).regex(/^https:\/\//, 'Use an https address')]),
  default: '',
  onReadFailure: { value: '' },
  input: { type: 'url', maxLength: 500 },
}

export const MARKETING_SETTINGS = {
  'marketing.newsletterEnabled': newsletterEnabled,
  'marketing.contactEnabled': contactEnabled,
  'marketing.calendarEnabled': calendarEnabled,
  'marketing.contactNotifyEmail': contactNotifyEmail,
  'marketing.calendarIcsUrl': calendarIcsUrl,
} as const satisfies Record<string, SettingDef>
