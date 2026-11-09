/**
 * Which voice channel a scheduled call uses, and which channels may be recorded (pure, no Discord imports).
 *
 * A call's channel is, in order: the Discord scheduled event's own channel; else the channel mapped to
 * its crew's event in the admin setting calls.crewVoiceChannels (delivered as byEvent); else nothing:
 * an event with no channel and no mapping is ignored, as before (the default channel only applies to
 * events that point at it). Only allowed channels may be joined: the default channel
 * (CALL_VOICE_CHANNEL_ID) plus those in calls.recordableVoiceChannels. Nothing else is ever recorded.
 */
import type { EventInfo } from './event-lifecycle.js'

export interface VoiceChannelSettings {
  /** Extra channels that may be recorded (the default channel is always allowed). */
  allowed: string[]
  /** Discord event id -> channel, for events with no channel of their own. */
  byEvent: { eventId: string; channelId: string }[]
}

export const VOICE_CHANNELS_OFF: VoiceChannelSettings = { allowed: [], byEvent: [] }

const SNOWFLAKE = /^\d{15,25}$/

/** Channels the recorder may join. */
export function allowedChannels(s: VoiceChannelSettings, defaultChannelId: string): Set<string> {
  return new Set([defaultChannelId, ...s.allowed])
}

/** The channel a call is held in, or null when it cannot be told. Does not check the allowlist. */
export function resolveEventChannel(event: Pick<EventInfo, 'id' | 'channelId'>, s: VoiceChannelSettings): string | null {
  if (event.channelId) return event.channelId
  return s.byEvent.find((m) => m.eventId === event.id)?.channelId ?? null
}

/** Events with their channel filled in, minus those in a channel that may not be recorded. */
export function recordableEvents(events: readonly EventInfo[], s: VoiceChannelSettings, defaultChannelId: string): EventInfo[] {
  const ok = allowedChannels(s, defaultChannelId)
  const out: EventInfo[] = []
  for (const e of events) {
    const ch = resolveEventChannel(e, s)
    if (ch && ok.has(ch)) out.push(e.channelId === ch ? e : { ...e, channelId: ch })
  }
  return out
}

/** Validates the delivered settings; anything malformed is dropped. */
export function parseVoiceChannels(raw: unknown, previousByEvent: VoiceChannelSettings['byEvent'] = []): VoiceChannelSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const allowed = Array.isArray(o.allowed)
    ? o.allowed.filter((x): x is string => typeof x === 'string' && SNOWFLAKE.test(x.trim())).map((x) => x.trim()).slice(0, 50)
    : []
  // byEvent omitted (the app could not read its crew mapping): keep the last good mapping.
  const byEvent = Array.isArray(o.byEvent)
    ? o.byEvent
        .flatMap((m: unknown) => {
          const r = (m && typeof m === 'object' ? m : {}) as Record<string, unknown>
          return typeof r.eventId === 'string' && r.eventId && typeof r.channelId === 'string' && SNOWFLAKE.test(r.channelId.trim())
            ? [{ eventId: r.eventId, channelId: r.channelId.trim() }]
            : []
        })
        .slice(0, 100)
    : previousByEvent
  return { allowed, byEvent }
}
