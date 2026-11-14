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
  schema: z.string().trim().max(80).regex(/^[^<>"\r\n]*$/, 'No angle brackets, quotes or line breaks'),
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

export const NEWSLETTER_SETTINGS = {
  'newsletter.confirmEmailsEnabled': confirmEmailsEnabled,
  'newsletter.memberOptInEnabled': memberOptInEnabled,
  'newsletter.fromName': fromName,
  'newsletter.fromAddress': fromAddress,
  'newsletter.replyTo': replyTo,
} as const satisfies Record<string, SettingDef>
