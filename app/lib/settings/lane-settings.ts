/**
 * Lane cards -> mission -> guide (plans/lane-cards-mission-onboarding.md). Off until turned on.
 * This file imports only types from ./registry.
 */
import { z } from 'zod'
import type { SettingDef } from './registry'

const laneCardsEnabled: SettingDef<boolean> = {
  key: 'onboarding.laneCardsEnabled',
  area: 'features',
  label: 'Lane cards link to step-by-step guides',
  help: 'The "find your lane" cards on the community page link to a guide for each published lane, members can pin a lane (and its mission), and the dashboard shows it. Off: the cards are plain, /lanes/* is not found and the lane APIs answer 404. The admin editor works either way, so lanes can be prepared before launch. The LANE_CARDS_ENABLED env var set to off always wins; on preview deploys only the env var counts.',
  schema: z.boolean(),
  default: false,
  onReadFailure: { value: false },
  input: { type: 'bool' },
  confirm: (from, to) => (to && !from ? 'The community page cards will link to the guides of every published lane.' : null),
}

export const LANE_SETTINGS = {
  'onboarding.laneCardsEnabled': laneCardsEnabled,
} as const satisfies Record<string, SettingDef>
