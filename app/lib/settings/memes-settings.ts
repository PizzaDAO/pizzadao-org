/**
 * Meme folder (bellpepper-80127): the switch, the moderation mode and the upload limits. Kept in its
 * own file so the registry only carries one spread line. Imports only types from ./registry.
 * Posting is off by default; viewing and uploading both need memes.enabled.
 */
import { z } from 'zod'
import type { SettingDef } from './registry'

const int = (key: string, label: string, help: string, min: number, max: number, def: number, unit?: string): SettingDef<number> => ({
  key,
  area: 'memes',
  label,
  help,
  schema: z.number().int().min(min).max(max),
  default: def,
  onReadFailure: { value: def },
  input: { type: 'int', min, max, ...(unit ? { unit } : {}) },
})

const enabled: SettingDef<boolean> = {
  key: 'memes.enabled',
  area: 'memes',
  label: 'Meme folder',
  help: 'Members can browse approved memes and upload their own from the dashboard. Off, the folder, the dashboard card and every meme route are hidden or answer "not available". The MEMES_ENABLED env var set to off always wins; on preview deploys only the env var counts.',
  schema: z.boolean(),
  default: false,
  onReadFailure: { value: false },
  input: { type: 'bool' },
  confirm: (from, to) => (to && !from ? 'Members will be able to upload memes and see approved ones.' : null),
}

const requireApproval: SettingDef<boolean> = {
  key: 'memes.requireApproval',
  area: 'memes',
  label: 'Capos approve memes before they show',
  help: 'On: every upload waits, privately, for a Pizza Capo or Dread Pizza Roberts to approve it. Off: uploads show at once and only reports (see the report limit below) or a capo take them down. If this cannot be read, approval stays required.',
  schema: z.boolean(),
  default: true,
  onReadFailure: { value: true },
  input: { type: 'bool' },
  confirm: (from, to) => (from && !to ? 'New uploads will show to every member immediately, without review.' : null),
}

export const MEMES_SETTINGS = {
  'memes.enabled': enabled,
  'memes.requireApproval': requireApproval,
  'memes.minCompletedLevel': int('memes.minCompletedLevel', 'Level needed to upload', 'Members must have completed this level to upload a meme. 0 lets any signed-in member upload. Everyone signed in can browse.', 0, 10, 1),
  'memes.maxUploadBytes': int('memes.maxUploadBytes', 'Largest meme file', 'Bytes. At most 4 MB: uploads pass through a server function whose request body limit is 4.5 MB. Images larger than 4096 px on a side are always refused.', 100_000, 4 * 1024 * 1024, 4 * 1024 * 1024, 'bytes'),
  'memes.maxGifFrames': int('memes.maxGifFrames', 'Most frames in a GIF', 'Animated GIFs with more frames than this are refused (a long GIF is heavy to show). Every frame must also fit within 4096 px.', 1, 1000, 300),
  'memes.maxUploadsPerDay': int('memes.maxUploadsPerDay', 'Uploads per member per day', 'Counted over the last 24 hours, including ones later deleted or rejected.', 1, 100, 10),
  'memes.maxPending': int('memes.maxPending', 'Waiting memes per member', "How many of one member's uploads can wait for review at once.", 1, 100, 20),
  'memes.autoHideReports': int('memes.autoHideReports', 'Reports that hide a meme', 'This many different members reporting an approved meme hides it until a capo restores or removes it.', 1, 20, 3),
} as const
