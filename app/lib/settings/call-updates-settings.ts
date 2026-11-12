/**
 * Spoken call updates (plans/metalhead-reads-updates.md, phase 1). Everything is off or empty by
 * default. Kept in its own file so the registry only carries one spread line for the group. Imports
 * only types from ./registry (no cycle).
 */
import { z } from 'zod'
import type { SettingDef } from './registry'

/** Base voices of OpenAI's gpt-4o-mini-tts. The style comes from calls.updatesVoiceInstructions. */
export const UPDATES_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'] as const

/** Section keys, in the default reading order. The intro and outro are not listed: they always stay. */
export const UPDATE_SECTION_KEYS = ['last-call', 'task-changes', 'priorities', 'events', 'announcements'] as const
export type UpdateSectionKey = (typeof UPDATE_SECTION_KEYS)[number]

export const UPDATES_INTRO_DEFAULT = 'Automated call updates for the {crew} call.'
export const UPDATES_OUTRO_DEFAULT = "That's the update."
export const UPDATES_VOICE_DEFAULT = 'ash'
/** A generic style prompt: it names no character or person. */
export const UPDATES_VOICE_INSTRUCTIONS_DEFAULT =
  'Voice: an energetic, laid-back surfer-dude robot with a slightly metallic, synthesized edge. Tone: friendly, upbeat and clear. Pacing: relaxed but easy to follow. Pronounce names and words clearly.'

export const UPDATES_LEAD_INS_DEFAULT = ['Dude, check it out:', 'Gnarly news, dudes:', 'Totally tubular:', 'Okay dudes,', 'Cowabunga!', 'Molto bene!'].join('\n')
export const LEAD_IN_MAX_CHARS = 40
export const LEAD_IN_MAX_LINES = 20

/** A spoken line that could be taken for a voice command: the outro and intro must never contain one. */
export const COMMAND_PHRASE = /\bmetalhead\b[\s,.:;!?-]*(?:please\s+)?(?:stop|pause|resume|skip|next|read|play|continue)\b/i

function bool(o: { key: string; area?: 'calls' | 'discord'; label: string; help: string; confirmOn?: string }): SettingDef<boolean> {
  return {
    key: o.key,
    area: o.area ?? 'calls',
    label: o.label,
    help: o.help,
    schema: z.boolean(),
    default: false,
    onReadFailure: { value: false },
    input: { type: 'bool' },
    confirm: o.confirmOn ? (from, to) => (to && !from ? o.confirmOn! : null) : undefined,
  }
}

function int(o: { key: string; label: string; help: string; min: number; max: number; default: number; unit?: string }): SettingDef<number> {
  return {
    key: o.key,
    area: 'calls',
    label: o.label,
    help: o.help,
    schema: z.number().int().min(o.min).max(o.max),
    default: o.default,
    onReadFailure: 'lastKnownGood',
    input: { type: 'int', min: o.min, max: o.max, ...(o.unit ? { unit: o.unit } : {}) },
  }
}

function text(o: { key: string; label: string; help: string; maxLength: number; default: string; multiline?: boolean; check?: (v: string) => boolean; checkMessage?: string }): SettingDef<string> {
  const base = z.string().trim().max(o.maxLength)
  return {
    key: o.key,
    area: 'calls',
    label: o.label,
    help: o.help,
    schema: o.check ? base.refine(o.check, o.checkMessage ?? 'Invalid value') : base,
    default: o.default,
    onReadFailure: { value: o.default },
    input: { type: 'text', maxLength: o.maxLength, ...(o.multiline ? { multiline: true } : {}) },
  }
}

const sectionsValid = (v: string) => {
  const keys = v.split('\n').map((l) => l.trim()).filter(Boolean)
  return keys.every((k) => (UPDATE_SECTION_KEYS as readonly string[]).includes(k)) && new Set(keys).size === keys.length
}

const leadInsValid = (v: string) => {
  const lines = v.split('\n').map((l) => l.trim()).filter(Boolean)
  return lines.length <= LEAD_IN_MAX_LINES && lines.every((l) => l.length <= LEAD_IN_MAX_CHARS && !COMMAND_PHRASE.test(l))
}

export const CALL_UPDATES_SETTINGS = {
  'calls.updatesEnabled': bool({
    key: 'calls.updatesEnabled',
    label: 'Spoken call updates',
    help: 'Lets a crew lead, admin or live host run /metalhead updates: the pizza-radio bot reads a short spoken update (last call\'s action items, task changes, priorities, upcoming events, announcements) in the call\'s voice channel. The voice is AI-generated (OpenAI) and the script says so. Needs the /metalhead command switch below, PIZZA_RADIO_URL and PIZZA_RADIO_API_KEY plus the OpenAI and R2 settings on the app (production only), and the /metalhead command registered with Discord. Uses the same private post filter as agendas. The CALL_UPDATES_ENABLED env var set to off always wins; on preview deploys only the env var counts, and previews never speak.',
    confirmOn: 'Pizza-radio will read call updates aloud in the voice channel when asked.',
  }),
  'discord.metalheadCommandEnabled': bool({
    key: 'discord.metalheadCommandEnabled',
    area: 'discord',
    label: '/metalhead command',
    help: 'Answers the /metalhead slash commands (updates, stop, pause, resume, skip, script). Off: they reply "not enabled". Only crew leads of the call\'s crew, admins and live hosts may use them (see "any member" below). The METALHEAD_COMMAND_ENABLED env var set to off always wins; on preview deploys only the env var counts.',
    confirmOn: '/metalhead will start, stop and pause spoken call updates for the people allowed to use it.',
  }),
  'calls.updatesControlAnyMember': bool({
    key: 'calls.updatesControlAnyMember',
    label: 'Updates: any member may stop or pause',
    help: 'Off (default): only crew leads of the call\'s crew, admins and live hosts can stop, pause, resume or skip the updates. On: any signed-up member can stop, pause, resume or skip (starting them stays restricted). Pizza-radio\'s own /stop always works for everyone. The CALL_UPDATES_CONTROL_ANY_MEMBER env var set to off always wins; on preview deploys only the env var counts.',
  }),
  'calls.updatesMaxSeconds': int({
    key: 'calls.updatesMaxSeconds',
    label: 'Updates: longest script',
    help: 'The script is cut to fit this length (about 150 spoken words a minute). Sections are dropped from the last one back: announcements, events, priorities, task changes, last call.',
    min: 30,
    max: 120,
    default: 90,
    unit: 'seconds',
  }),
  'calls.updatesSections': text({
    key: 'calls.updatesSections',
    label: 'Updates: sections and order',
    help: 'One section per line, in reading order. Allowed: last-call, task-changes, priorities, events, announcements. Remove a line to drop that section. The intro and outro always stay.',
    maxLength: 200,
    multiline: true,
    default: UPDATE_SECTION_KEYS.join('\n'),
    check: sectionsValid,
    checkMessage: 'Use last-call, task-changes, priorities, events, announcements: one per line, no repeats',
  }),
  'calls.updatesIntro': text({
    key: 'calls.updatesIntro',
    label: 'Updates: intro line',
    help: 'Spoken first. {crew} becomes the crew name. Keep "automated" in it: listeners must be told the voice is AI-generated.',
    maxLength: 200,
    default: UPDATES_INTRO_DEFAULT,
    check: (v) => !COMMAND_PHRASE.test(v),
    checkMessage: 'Must not contain a voice command such as "Metalhead, stop"',
  }),
  'calls.updatesOutro': text({
    key: 'calls.updatesOutro',
    label: 'Updates: outro line',
    help: 'Spoken last. Must not contain a voice command phrase (so an echo can never trigger anything).',
    maxLength: 200,
    default: UPDATES_OUTRO_DEFAULT,
    check: (v) => !COMMAND_PHRASE.test(v),
    checkMessage: 'Must not contain a voice command such as "Metalhead, stop"',
  }),
  'calls.updatesAnnouncements': text({
    key: 'calls.updatesAnnouncements',
    label: 'Updates: announcements',
    help: 'One announcement per line, read near the end (at most 3 per call). Start a line with "Crew name: " to read it only on that crew\'s call. Plain text: links, emoji and mentions are removed. Keep private matters out of this list: it is spoken in the voice channel.',
    maxLength: 1000,
    multiline: true,
    default: '',
  }),
  'calls.updatesSectionLeadIns': text({
    key: 'calls.updatesSectionLeadIns',
    label: 'Updates: section lead-ins',
    help: `One short phrase per line (at most ${LEAD_IN_MAX_LINES} lines, ${LEAD_IN_MAX_CHARS} characters each). Sometimes spoken before a section, never before the intro or outro and never the same one twice in a row. Must not contain a voice command such as "Metalhead, stop". They count toward the longest-script limit and are dropped before any section is. Empty: none.`,
    maxLength: 900,
    multiline: true,
    default: UPDATES_LEAD_INS_DEFAULT,
    check: leadInsValid,
    checkMessage: `At most ${LEAD_IN_MAX_LINES} lines of ${LEAD_IN_MAX_CHARS} characters, no voice command such as "Metalhead, stop"`,
  }),
  'calls.updatesLeadInChance': int({
    key: 'calls.updatesLeadInChance',
    label: 'Updates: lead-in chance',
    help: 'The chance, per section after the first, that a lead-in phrase is spoken first. 0 turns lead-ins off.',
    min: 0,
    max: 100,
    default: 40,
    unit: 'percent',
  }),
  'calls.updatesVoice': text({
    key: 'calls.updatesVoice',
    label: 'Updates: base voice',
    help: `One of: ${UPDATES_VOICES.join(', ')}. The style comes from the next setting. Use "Generate sample" on the admin calls page (production only) to hear each one.`,
    maxLength: 20,
    default: UPDATES_VOICE_DEFAULT,
    check: (v) => (UPDATES_VOICES as readonly string[]).includes(v),
    checkMessage: `Pick one of: ${UPDATES_VOICES.join(', ')}`,
  }),
  'calls.updatesVoiceInstructions': text({
    key: 'calls.updatesVoiceInstructions',
    label: 'Updates: voice style',
    help: 'A tone and style prompt sent to the text-to-speech model with every clip. Describe the voice generically (energy, pacing, character of the delivery); do not name a real person or copyrighted character.',
    maxLength: 600,
    multiline: true,
    default: UPDATES_VOICE_INSTRUCTIONS_DEFAULT,
  }),
  'calls.updatesPauseMaxMinutes': int({
    key: 'calls.updatesPauseMaxMinutes',
    label: 'Updates: longest pause',
    help: 'A paused update stops on its own and the bot leaves after this long.',
    min: 1,
    max: 15,
    default: 5,
    unit: 'minutes',
  }),
} as const satisfies Record<string, SettingDef>
