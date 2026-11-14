/**
 * Buddy system, phase 1 (plans/buddy-system.md): who may be a buddy, how many trainees one buddy
 * takes, where intro threads go and what they say. Kept in its own file so the registry only carries
 * a few lines. Every switch is off by default. This file imports only types from ./registry.
 */
import { z } from 'zod'
import type { SettingDef } from './registry'

const ENV_NOTE = 'The matching env var set to off always wins; on preview deploys only the env var counts.'

const toggle = (key: string, label: string, help: string, confirmOn: string): SettingDef<boolean> => ({
  key,
  area: 'buddy',
  label,
  help: `${help} ${ENV_NOTE}`,
  schema: z.boolean(),
  default: false,
  onReadFailure: { value: false },
  input: { type: 'bool' },
  confirm: (from, to) => (to && !from ? confirmOn : null),
})

const int = (key: string, label: string, help: string, min: number, max: number, def: number): SettingDef<number> => ({
  key,
  area: 'buddy',
  label,
  help,
  schema: z.number().int().min(min).max(max),
  default: def,
  onReadFailure: { value: def },
  input: { type: 'int', min, max },
})

export const DEFAULT_BUDDY_INTRO_TEXT =
  'Welcome {trainee}! {buddy} is your buddy: they will help you get going. Say hi here, ask anything, and ask them to bring you to your first call.'

const introText: SettingDef<string> = {
  key: 'buddy.introText',
  area: 'buddy',
  label: 'Buddy intro message',
  help: 'The first message in the private buddy thread. {trainee} and {buddy} become mentions of the two people. Only those two are pinged.',
  schema: z.string().trim().min(1).max(1500),
  default: DEFAULT_BUDDY_INTRO_TEXT,
  onReadFailure: { value: DEFAULT_BUDDY_INTRO_TEXT },
  input: { type: 'text', multiline: true, maxLength: 1500 },
}

const channel: SettingDef<string> = {
  key: 'discord.buddyChannelId',
  area: 'discord',
  label: 'Buddy channel',
  help: 'The channel where private buddy threads are created (the bot needs Create Private Threads and Send Messages in Threads there). Empty: no threads are opened. Checked against the server when saved.',
  schema: z.union([z.string().regex(/^\d{5,25}$/, 'Not a Discord id'), z.literal('')]),
  default: '',
  onReadFailure: 'lastKnownGood',
  input: { type: 'channel', kind: 'text' },
  confirm: (from, to) => (to && to !== from ? 'Buddy threads will be created in the new channel from now on.' : null),
}

export const BUDDY_SETTINGS = {
  'buddy.enabled': toggle(
    'buddy.enabled',
    'Buddy system',
    'Members at or above the minimum level can offer to be a buddy, buddies and trainees see their buddy card on the dashboard, and admins can pair people on /admin/buddies. Off, none of it shows and no pair can be made.',
    'Eligible members will be able to offer to be a buddy, and the buddy cards will show on dashboards.',
  ),
  'buddy.introThreadsEnabled': toggle(
    'buddy.introThreadsEnabled',
    'Open a private intro thread when two people are paired',
    'The bot opens a private thread in the buddy channel and adds both people. Off, pairing only records what the thread would have said (a dry run in the pair history).',
    'The bot will start opening private threads and pinging members.',
  ),
  'buddy.rewardEnabled': toggle(
    'buddy.rewardEnabled',
    'Reward buddies when a trainee finishes',
    'When a pair completes, the buddy is given the bonus mission set below (so its normal bonus PEP pays out). Off, completion only records that the reward would have been given.',
    'Buddies will start receiving the bonus mission when their trainee finishes.',
  ),
  'buddy.publicRecognitionEnabled': toggle(
    'buddy.publicRecognitionEnabled',
    'Show buddies on public profiles and /buddies',
    'Buddies get a "helped N trainees" line and badge on their profile, finished trainees get "Onboarded with help from ...", and /buddies lists the top buddies. Only completed pairs show, and members can opt out on their buddy card. Needs the buddy system on too. Off, none of it shows.',
    'Completed buddy pairs will be shown on public profiles and on the /buddies page (members can opt out).',
  ),
  'buddy.minLevel': int(
    'buddy.minLevel',
    'Minimum level to be a buddy',
    'A member can offer to be a buddy once their current mission level is at least this. Admins can add someone below it by hand.',
    1,
    9,
    4,
  ),
  'buddy.maxActivePerBuddy': int(
    'buddy.maxActivePerBuddy',
    'Most trainees per buddy',
    'No buddy is given more active trainees than this, whatever limit they set themselves.',
    1,
    10,
    2,
  ),
  'buddy.completionLevel': int(
    'buddy.completionLevel',
    'Level a trainee finishes the pairing at',
    'A pair is done once the trainee has completed this missions level (the same rule that removes Pizza Noob at level 2).',
    1,
    9,
    2,
  ),
  'buddy.introRecheckHours': int(
    'buddy.introRecheckHours',
    'Hours to wait before cancelling a pair that cannot see the buddy channel',
    'If the trainee or buddy cannot see the buddy channel, the intro waits. It is re-checked every hour and opens as soon as both can view it. The first failed check after this many hours cancels the pair (reason no_channel_access) and the trainee goes back to the unmatched list.',
    1,
    168,
    24,
  ),
  'buddy.maxCancelsPerRun': int(
    'buddy.maxCancelsPerRun',
    'Most no-access cancellations in one run',
    'Safety brake: if one hourly or daily run would cancel more pairs than this (for example a channel permission change made everyone lose access), it cancels none and flags the pairs on /admin/buddies.',
    1,
    50,
    3,
  ),
  'buddy.rewardMissionId': int(
    'buddy.rewardMissionId',
    'Buddy reward: bonus mission id',
    'The bonus mission (created in /admin/missions) that is marked done for a buddy when their trainee finishes. 0 means no reward.',
    0,
    1000000,
    0,
  ),
  'discord.buddyChannelId': channel,
  'buddy.introText': introText,
} as const satisfies Record<string, SettingDef>
