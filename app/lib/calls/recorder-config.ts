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

export interface RecorderConfig {
  welcome: { enabled: boolean; template: string; batchSeconds: number; recordingLine: string }
  endSong: { enabled: boolean; minHumans: number }
  /** Discord event id -> crew label, for naming the call in messages. */
  /** callMinutes: the crew's usual call length, for the end-of-call song when the event has no end time. */
  crews: { eventId: string; label: string; callMinutes?: number }[]
}

export const RECORDER_CONFIG_OFF: RecorderConfig = {
  welcome: {
    enabled: false,
    template: 'Welcome {members} to the {call} 🍕',
    batchSeconds: 20,
    recordingLine: "🔴 This call is recorded and transcribed; audio stays private. Leave the call if you'd rather not be recorded.",
  },
  endSong: { enabled: false, minHumans: 1 },
  crews: [],
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
    },
    crews: await loadCrewLabels(),
  }
}
