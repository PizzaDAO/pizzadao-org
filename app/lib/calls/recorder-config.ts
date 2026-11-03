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
import { liveConfigFrom } from '@/app/lib/calls/live-items'

export interface RecorderConfig {
  welcome: { enabled: boolean; template: string; batchSeconds: number; recordingLine: string }
  endSong: { enabled: boolean; minHumans: number; crewMap: { crew: string; radio: string }[] }
  /** Discord event id -> crew label, for naming the call in messages. */
  /** callMinutes: the crew's usual call length, for the end-of-call song when the event has no end time. */
  crews: { eventId: string; label: string; callMinutes?: number }[]
  /**
   * Live action items (plans/post-call-agenda-updates.md, options A and C): speech chunks every
   * chunkSeconds (audio), prefixed chat lines (chat), only for the Discord events of allowlisted crews.
   * The app re-checks everything (allowlist, private post filter) on each request.
   */
  liveItems: { audio: boolean; chunkSeconds: number; chat: boolean; prefixes: string[]; eventIds: string[] }
}

export const RECORDER_CONFIG_OFF: RecorderConfig = {
  welcome: {
    enabled: false,
    template: 'Welcome {members} to the {call} 🍕',
    batchSeconds: 20,
    recordingLine: "🔴 This call is recorded and transcribed; audio stays private. Leave the call if you'd rather not be recorded.",
  },
  endSong: { enabled: false, minHumans: 1, crewMap: [] },
  crews: [],
  liveItems: { audio: false, chunkSeconds: 150, chat: false, prefixes: [], eventIds: [] },
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
    endSong: {
      enabled: resolveToggle('calls.endSongTriggerEnabled', settings),
      minHumans: settings.get('calls.endSongMinHumans'),
      crewMap: parseCrewMap(settings.get('calls.endSongCrewMap')),
    },
    crews: await loadCrewLabels(),
    liveItems: await liveItemsConfig(settings),
  }
}

async function liveItemsConfig(settings: Awaited<ReturnType<typeof loadSettings>>): Promise<RecorderConfig['liveItems']> {
  const live = liveConfigFrom(settings)
  if (!live.audio && !live.chat) return RECORDER_CONFIG_OFF.liveItems
  const eventIds = await loadCrewEventIds(live.crews)
  if (eventIds.length === 0) return RECORDER_CONFIG_OFF.liveItems
  return { audio: live.audio, chunkSeconds: live.chunkSeconds, chat: live.chat, prefixes: live.chat ? live.prefixes : [], eventIds }
}
