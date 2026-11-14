/**
 * The public features catalog (plans/features-catalog.md): the page, its machine-readable exports, the
 * header link and whether ops tools are listed. Kept in its own file so the registry only carries one
 * spread line. Everything is off or empty by default. This file imports only types from ./registry.
 */
import { z } from 'zod'
import type { SettingDef } from './registry'

const ENV_NOTE = 'The matching env var set to off always wins; on preview deploys only the env var counts.'

const toggle = (key: string, label: string, help: string, confirmOn: string): SettingDef<boolean> => ({
  key,
  area: 'features',
  label,
  help: `${help} ${ENV_NOTE}`,
  schema: z.boolean(),
  default: false,
  onReadFailure: { value: false },
  input: { type: 'bool' },
  confirm: (from, to) => (to && !from ? confirmOn : null),
})

const publicEnabled = toggle(
  'features.publicEnabled',
  'Show the public features page',
  'Off, /features answers 404. Only rows an admin has published appear (edit them at /admin/features).',
  'The public features page will go live with the published rows.',
)

const exportEnabled = toggle(
  'features.exportEnabled',
  'Publish the features exports (JSON, Markdown, llms.txt)',
  'Off, /features.json, /features.md and /llms.txt answer 404. They carry the same published rows as the page.',
  'The machine-readable features exports will go live.',
)

const navLinkEnabled = toggle(
  'features.navLinkEnabled',
  'Show a features link in the website header',
  'Adds a "What we have built" link to the marketing header. Does nothing while the page itself is off.',
  'The website header will link to the features page.',
)

const showOps = toggle(
  'features.showOps',
  'List ops tools on the features page',
  'Shows rows whose only audience is ops as "How we run the DAO". Off, they stay hidden.',
  'Admin and ops tools will be listed publicly.',
)

const introText: SettingDef<string> = {
  key: 'features.introText',
  area: 'features',
  label: 'Features page intro',
  help: 'One short paragraph under the page title. Empty: a default sentence is shown.',
  schema: z.string().trim().max(400),
  default: '',
  onReadFailure: { value: '' },
  input: { type: 'text', maxLength: 400, multiline: true },
}

const contributeUrl: SettingDef<string> = {
  key: 'features.contributeUrl',
  area: 'features',
  label: 'Builders link',
  help: 'Where the builders section sends people who want to contribute. Empty: no link is shown.',
  schema: z.union([z.literal(''), z.string().trim().url().max(300).regex(/^https?:\/\//i, 'Must start with http:// or https://')]),
  default: '',
  onReadFailure: { value: '' },
  input: { type: 'url', maxLength: 300 },
}

const githubCacheMinutes: SettingDef<number> = {
  key: 'features.githubCacheMinutes',
  area: 'features',
  label: 'GitHub facts cache (minutes)',
  help: 'How long repo facts (default branch, license, last commit) are cached for the page and exports.',
  schema: z.number().int().min(5).max(1440),
  default: 60,
  onReadFailure: { value: 60 },
  input: { type: 'int', min: 5, max: 1440, unit: 'minutes' },
}

export const FEATURES_SETTINGS = {
  'features.publicEnabled': publicEnabled,
  'features.exportEnabled': exportEnabled,
  'features.navLinkEnabled': navLinkEnabled,
  'features.showOps': showOps,
  'features.introText': introText,
  'features.contributeUrl': contributeUrl,
  'features.githubCacheMinutes': githubCacheMinutes,
} as const satisfies Record<string, SettingDef>
