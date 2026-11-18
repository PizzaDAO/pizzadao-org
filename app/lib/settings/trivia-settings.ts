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

export const TRIVIA_SETTINGS = {
  'trivia.enabled': enabled,
  'trivia.dryRun': dryRun,
  'trivia.rewardPep': rewardPep,
  'trivia.channelId': channelId,
  'trivia.roundsPerDay': roundsPerDay,
} as const
