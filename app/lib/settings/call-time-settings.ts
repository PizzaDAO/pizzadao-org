/**
 * Intended local start times of the recurring crew-call Discord events (plans/dst-crew-call-times.md).
 * Discord repeats a recurring event in fixed UTC, so after each DST change every call is an hour off in
 * local time; the DST sync cron compares each event's next start with the row here and moves it.
 *
 * This file imports only types from ./registry (no runtime cycle).
 */
import { z } from 'zod'
import { DEFAULT_CALL_TIME_ZONE, formatHHMM, isValidTimeZone, parseHHMM } from '@/app/lib/calls/zoned-time'
import type { SettingDef } from './registry'

export interface EventLocalTime {
  eventId: string
  label: string
  /** "HH:MM", 24 hour. */
  localTime: string
  /** IANA zone. */
  timeZone: string
}

const row = z.object({
  eventId: z.string().trim().regex(/^\d{17,20}$/, 'Event id must be the 17-20 digit Discord id'),
  label: z.string().trim().max(64).default(''),
  localTime: z
    .string()
    .trim()
    .transform((v, ctx) => {
      const t = parseHHMM(v)
      if (!t) {
        ctx.addIssue({ code: 'custom', message: 'Time must look like 14:00 (24 hour)' })
        return z.NEVER
      }
      return formatHHMM(t)
    }),
  timeZone: z
    .string()
    .trim()
    .transform((v) => v || DEFAULT_CALL_TIME_ZONE)
    .refine(isValidTimeZone, 'Not an IANA time zone (for example America/New_York)'),
})

const eventLocalTimes: SettingDef<EventLocalTime[]> = {
  key: 'calls.eventLocalTimes',
  area: 'calls',
  label: 'Crew call local times',
  help: 'The intended wall-clock start of each recurring crew-call Discord event, so the DST sync can move it after a clock change. Event id is the Discord scheduled event id; time is 24 hour (14:00); zone is an IANA name, blank means America/New_York. Use "Fill from Discord" on /admin/calls to add rows from the current events. Nothing moves unless the DST sync is switched on and dry run is off.',
  schema: z
    .array(row)
    .max(60)
    .superRefine((rows, ctx) => {
      const seen = new Set<string>()
      rows.forEach((r, i) => {
        if (seen.has(r.eventId)) ctx.addIssue({ code: 'custom', path: [i], message: `${r.eventId} is listed twice` })
        seen.add(r.eventId)
      })
    }),
  default: [],
  onReadFailure: 'lastKnownGood',
  input: {
    type: 'table',
    columns: [
      { key: 'eventId', label: 'Discord event id', kind: 'text', maxLength: 20 },
      { key: 'label', label: 'Label (crew)', kind: 'text', maxLength: 64 },
      { key: 'localTime', label: 'Local time (HH:MM)', kind: 'text', maxLength: 5 },
      { key: 'timeZone', label: 'Time zone', kind: 'text', maxLength: 64 },
    ],
    maxRows: 60,
  },
}

export const CALL_TIME_SETTINGS = {
  'calls.eventLocalTimes': eventLocalTimes,
} as const satisfies Record<string, SettingDef>
