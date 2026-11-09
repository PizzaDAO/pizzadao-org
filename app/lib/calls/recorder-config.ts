/**
 * What the call recorder (a separate Railway worker with no database access) may read from the
 * admin settings: GET /api/calls/recorder/config. Recorder-facing values only, never a secret.
 * Keep the shape in sync with recorder/src/remote-config.ts.
 *
 * Every behaviour here defaults to OFF; the recorder also falls back to this all-off shape when the
 * app cannot be reached (plans/metalhead-call-features.md, phase 0).
 */
import { getCrewMappings } from '@/app/lib/crew-mappings'
import { extractEventId } from '@/app/lib/calls/crew-map'
import { loadSettings } from '@/app/lib/settings'
import { resolveToggle } from '@/app/lib/settings/toggles'
import { END_SONG_CREW_LINE } from '@/app/lib/settings/registry'
import { normalizeCrewId } from '@/app/lib/crew-id'
import { normalizeKeyterms } from '@/app/lib/calls/keyterms'
import { liveConfigFrom } from '@/app/lib/calls/live-items'
import { parseCrewVoiceChannels, VOICE_CHANNEL_ID_LINE } from '@/app/lib/settings/registry'

export interface RecorderConfig {
  welcome: { enabled: boolean; template: string; batchSeconds: number; recordingLine: string }
  /** Text posted in the voice channel chat when a call starts; empty = nothing (calls.startNotice). */
  startNotice: string
  endSong: { enabled: boolean; minHumans: number; crewMap: { crew: string; radio: string }[] }
  /** House band at the start of the listed calls (pizza-radio /play-band). */
  startBand: { enabled: boolean; calls: string[]; maxSongs: number }
  /** Discord event id -> crew label, for naming the call in messages. */
  /** callMinutes: the crew's usual call length, for the end-of-call song when the event has no end time. */
  crews: { eventId: string; label: string; callMinutes?: number }[]
  /**
   * Live action items (plans/post-call-agenda-updates.md, options A and C): speech chunks every
   * chunkSeconds (audio), prefixed chat lines (chat), only for the Discord events of allowlisted crews.
   * The app re-checks everything (allowlist, private post filter) on each request.
   */
  liveItems: { audio: boolean; chunkSeconds: number; chat: boolean; prefixes: string[]; eventIds: string[] }
  /** Longest a switch to the next crew's event waits while the current call still has people talking; 0 = never wait. */
  supersedeMaxDeferMinutes: number
  /** Spellings for Deepgram to prefer (keyterm prompting); empty = none. */
  transcriptionKeyterms: string[]
  /** Channels the recorder may join, and the channel of events that have none of their own (by Discord event id). */
  voiceChannels: { allowed: string[]; byEvent?: { eventId: string; channelId: string }[] }
}

export const RECORDER_CONFIG_OFF: RecorderConfig = {
  welcome: {
    enabled: false,
    template: 'Welcome {members} to the {call} 🍕',
    batchSeconds: 20,
    recordingLine: "🔴 This call is recorded and transcribed; audio stays private. Leave the call if you'd rather not be recorded.",
  },
  startNotice: '',
  endSong: { enabled: false, minHumans: 1, crewMap: [] },
  startBand: { enabled: false, calls: [], maxSongs: 1 },
  crews: [],
  liveItems: { audio: false, chunkSeconds: 150, chat: false, prefixes: [], eventIds: [] },
  supersedeMaxDeferMinutes: 0,
  transcriptionKeyterms: [],
  voiceChannels: { allowed: [], byEvent: [] },
}

/** Discord event ids of the given crews (normalized ids). A mapping read failure gives none. */
export async function loadCrewEventIds(crewIds: readonly string[]): Promise<string[]> {
  if (crewIds.length === 0) return []
  try {
    const { crews } = await getCrewMappings()
    const want = new Set(crewIds)
    return [...new Set(crews.filter((c) => want.has(normalizeCrewId(c.id))).flatMap((c) => extractEventId(c.event) ?? []))]
  } catch {
    return []
  }
}

/** Crew labels by event id. A mapping read failure gives an empty list (the recorder uses the event name). */
export async function loadCrewLabels(): Promise<RecorderConfig['crews']> {
  try {
    const { crews } = await getCrewMappings()
    const out: RecorderConfig['crews'] = []
    for (const c of crews) {
      const eventId = extractEventId(c.event)
      if (!eventId || !c.label) continue
      const minutes = Number.parseInt(c.callLength || '', 10)
      out.push({ eventId, label: c.label, ...(Number.isFinite(minutes) && minutes > 0 && minutes <= 600 ? { callMinutes: minutes } : {}) })
    }
    return out
  } catch {
    return []
  }
}

/** `our label = radio crew` lines -> pairs (bad lines skipped). */
export function parseCrewMap(raw: string): { crew: string; radio: string }[] {
  const out: { crew: string; radio: string }[] = []
  for (const line of raw.split('\n')) {
    const m = END_SONG_CREW_LINE.exec(line.trim())
    if (m) out.push({ crew: m[1].trim(), radio: m[2].trim() })
  }
  return out
}

/** One name per line, blanks dropped. */
export function parseLines(raw: string): string[] {
  return raw.split('\n').map((l) => l.trim()).filter(Boolean)
}

export async function buildRecorderConfig(): Promise<RecorderConfig> {
  const settings = await loadSettings()
  return {
    welcome: {
      // resolveToggle: the env kill switch, "previews ignore saved rows" and unreadable-settings-means-off all apply.
      enabled: resolveToggle('calls.welcomeEnabled', settings),
      template: settings.get('calls.welcomeTemplate'),
      batchSeconds: settings.get('calls.welcomeBatchSeconds'),
      recordingLine: settings.get('calls.recordingLine'),
    },
    startNotice: settings.get('calls.startNotice'),
    endSong: {
      enabled: resolveToggle('calls.endSongTriggerEnabled', settings),
      minHumans: settings.get('calls.endSongMinHumans'),
      crewMap: parseCrewMap(settings.get('calls.endSongCrewMap')),
    },
    startBand: {
      enabled: resolveToggle('calls.startBandEnabled', settings),
      calls: parseLines(settings.get('calls.startBandCalls')),
      maxSongs: settings.get('calls.startBandMaxSongs'),
    },
    crews: await loadCrewLabels(),
    liveItems: await liveItemsConfig(settings),
    supersedeMaxDeferMinutes: settings.get('calls.supersedeMaxDeferMinutes'),
    transcriptionKeyterms: normalizeKeyterms(parseLines(settings.get('calls.transcriptionTerms'))),
    voiceChannels: await voiceChannelsConfig(settings),
  }
}

async function liveItemsConfig(settings: Awaited<ReturnType<typeof loadSettings>>): Promise<RecorderConfig['liveItems']> {
  const live = liveConfigFrom(settings)
  if (!live.audio && !live.chat) return RECORDER_CONFIG_OFF.liveItems
  const eventIds = await loadCrewEventIds(live.crews)
  if (eventIds.length === 0) return RECORDER_CONFIG_OFF.liveItems
  return { audio: live.audio, chunkSeconds: live.chunkSeconds, chat: live.chat, prefixes: live.chat ? live.prefixes : [], eventIds }
}

/** calls.recordableVoiceChannels + calls.crewVoiceChannels (crew ids resolved to Discord event ids). */
async function voiceChannelsConfig(settings: Awaited<ReturnType<typeof loadSettings>>): Promise<RecorderConfig['voiceChannels']> {
  const allowed = [...new Set(parseLines(settings.get('calls.recordableVoiceChannels')).filter((l) => VOICE_CHANNEL_ID_LINE.test(l)))]
  const byCrew = parseCrewVoiceChannels(settings.get('calls.crewVoiceChannels'))
  if (byCrew.size === 0) return { allowed, byEvent: [] }
  const byEvent: { eventId: string; channelId: string }[] = []
  try {
    const { crews } = await getCrewMappings()
    for (const c of crews) {
      const channelId = byCrew.get(normalizeCrewId(c.id).toLowerCase())
      const eventId = extractEventId(c.event)
      if (channelId && eventId) byEvent.push({ eventId, channelId })
    }
  } catch {
    // Mapping unreadable: omit byEvent (not []), so the recorder keeps the last mapping it had.
    return { allowed }
  }
  return { allowed, byEvent }
}
