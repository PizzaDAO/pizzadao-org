/**
 * Discord trivia, phase 2 (plans/trivia.md section 6). Every switch is off by default. Kept in its own
 * file so the registry only carries one spread line. Imports only types from ./registry.
 *
 * The fixed parts of the loop (10-minute rounds, 3 wins per member per day, onboarded members only,
 * accounts at least 7 days old, the discord question pool, reveal when nobody wins) are constants in
 * app/lib/trivia/config.ts, not settings: they are the approved launch rules, not knobs.
 */
import { z } from 'zod'
import type { SettingDef } from './registry'

const enabled: SettingDef<boolean> = {
  key: 'trivia.enabled',
  area: 'trivia',
  label: 'Discord trivia',
  help: 'The bot posts a trivia round in the trivia channel on its schedule, accepts typed answers and pays the winner. Off, nothing is posted, accepted or paid. The TRIVIA_DISCORD_ENABLED env var set to off always wins; on preview deploys only the env var counts (and the cron never runs there).',
  schema: z.boolean(),
  default: false,
  onReadFailure: { value: false },
  input: { type: 'bool' },
  confirm: (from, to) => (to && !from ? 'The bot will start posting trivia rounds and (unless dry run is on) paying $PEP.' : null),
}

const dryRun: SettingDef<boolean> = {
  key: 'trivia.dryRun',
  area: 'trivia',
  label: 'Trivia dry run (no $PEP paid)',
  help: 'Rounds are posted and judged exactly as normal, but the winner is paid nothing and the post says so. Use it for the first rounds in a test channel. The mode is fixed when a round opens. The TRIVIA_DRY_RUN env var set to on forces a dry run whatever is saved here.',
  schema: z.boolean(),
  default: false,
  // If the setting cannot be read, pay nothing.
  onReadFailure: { value: true },
  input: { type: 'bool' },
  confirm: (from, to) => (!to && from ? 'New rounds will pay the winner real $PEP.' : null),
}

const rewardPep: SettingDef<number> = {
  key: 'trivia.rewardPep',
  area: 'trivia',
  label: 'Trivia reward ($PEP per win)',
  help: 'What the first correct answer wins. At most 50. A member can win at most 3 rounds a day.',
  schema: z.number().int().min(0).max(50),
  default: 20,
  onReadFailure: 'lastKnownGood',
  input: { type: 'int', min: 0, max: 50, unit: '$PEP' },
  confirm: (from, to) => (to > from ? `Each win will pay ${to} $PEP.` : null),
}

const webDailyRewardPep: SettingDef<number> = {
  key: 'trivia.webDailyRewardPep',
  area: 'trivia',
  label: 'Web daily reward ($PEP)',
  help: 'What a signed-in member earns for answering the web daily (pizzadao.org/trivia) correctly on their one attempt. 0 turns it off. At most 25, once per member per day, only for onboarded members on Discord accounts at least 7 days old. Does not count toward the Discord 3-wins-a-day cap. Paid only while trivia is enabled and not in dry run.',
  schema: z.number().int().min(0).max(25),
  default: 0,
  onReadFailure: { value: 0 },
  input: { type: 'int', min: 0, max: 25, unit: '$PEP' },
  confirm: (from, to) => (to > from ? `A correct web daily answer will pay ${to} $PEP.` : null),
}

const channelId: SettingDef<string> = {
  key: 'trivia.channelId',
  area: 'trivia',
  label: 'Trivia channel',
  help: 'Where rounds are posted and answers are read (stored as a channel id, so renaming the channel changes nothing). Empty: the bot uses the mission review channel (#work) and saves its id here the first time it needs it. Checked against the server when saved.',
  schema: z.union([z.string().regex(/^\d{5,25}$/, 'Not a Discord id'), z.literal('')]),
  default: '',
  onReadFailure: 'lastKnownGood',
  input: { type: 'channel', kind: 'text' },
  confirm: (from, to) => (to && to !== from ? 'Trivia rounds will be posted in the new channel from now on.' : null),
}

const roundsPerDay: SettingDef<number> = {
  key: 'trivia.roundsPerDay',
  area: 'trivia',
  label: 'Rounds per day',
  help: 'How many rounds the schedule posts each UTC day, at random minutes inside the evening windows (US, EU, Asia). Admins can still start one by hand with /trivia start.',
  schema: z.number().int().min(1).max(6),
  default: 3,
  onReadFailure: 'lastKnownGood',
  input: { type: 'int', min: 1, max: 6 },
}

const disabledQuestionIds: SettingDef<string[]> = {
  key: 'trivia.disabledQuestionIds',
  area: 'trivia',
  label: 'Pulled trivia questions',
  help: 'Question ids (like pd-004) that are never asked, in Discord or on the web. Added by the one-click disable on /admin/trivia, and automatically when 3 different members report a question within 7 days. Remove an id to bring the question back.',
  schema: z.array(z.string().regex(/^[a-z]{2,4}-\d{3}$/, 'Not a question id like pd-004')).max(1000),
  default: [],
  onReadFailure: 'lastKnownGood',
  input: { type: 'stringList', maxItems: 1000, maxLength: 12 },
}

export const TRIVIA_SETTINGS = {
  'trivia.enabled': enabled,
  'trivia.dryRun': dryRun,
  'trivia.rewardPep': rewardPep,
  'trivia.webDailyRewardPep': webDailyRewardPep,
  'trivia.channelId': channelId,
  'trivia.roundsPerDay': roundsPerDay,
  'trivia.disabledQuestionIds': disabledQuestionIds,
} as const
