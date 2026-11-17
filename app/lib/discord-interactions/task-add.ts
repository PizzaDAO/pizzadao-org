/**
 * Validation for /task add (pure, so it is easy to test): the task text, the priority and the due
 * date. The handler runs these before deferring so typos are answered at once. Output matches what the
 * crew page editor stores (ISO dates, "Top" | "High" | "Mid" | "Low").
 */
import { DEFAULT_CALL_TIME_ZONE, wallTimeIn } from '@/app/lib/calls/zoned-time'
import { normalizeLabel } from '@/app/lib/sheets-import/plan'

/** Same key as createCrewTask's freshKey, so dedupe agrees with the unique natural key. */
export const normalizeForDedupe = normalizeLabel

export const TASK_MIN_CHARS = 3
export const TASK_MAX_CHARS = 300
export const PRIORITIES = ['Top', 'High', 'Mid', 'Low'] as const
/** Dates further ahead than this many years are treated as typos. */
const MAX_YEARS_AHEAD = 2

export type Checked<T> = ({ ok: true } & T) | { ok: false; error: string }

/** Collapse whitespace, drop control and zero-width characters, and check the length (in code points). */
export function cleanTaskText(raw: unknown): Checked<{ label: string }> {
  if (typeof raw !== 'string') return { ok: false, error: 'Say what needs doing.' }
  const label = raw
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const len = Array.from(label).length
  if (len < TASK_MIN_CHARS) return { ok: false, error: `Describe the task in at least ${TASK_MIN_CHARS} characters.` }
  if (len > TASK_MAX_CHARS) return { ok: false, error: `Keep the task under ${TASK_MAX_CHARS} characters (it is ${len}).` }
  if (!/[\p{L}\p{N}]/u.test(label)) return { ok: false, error: 'Describe the task with some words.' }
  return { ok: true, label }
}

/** Top, High, Mid or Low; empty means none. Anything else (a forged payload) is an error. */
export function parsePriority(raw: unknown): Checked<{ priority: string | null }> {
  if (raw === undefined || raw === null || raw === '') return { ok: true, priority: null }
  const found = PRIORITIES.find((p) => p === raw)
  return found ? { ok: true, priority: found } : { ok: false, error: 'Pick a priority from the list: Top, High, Mid or Low.' }
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const pad = (n: number) => String(n).padStart(2, '0')
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`

function isRealDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}

type Parts = { year?: number; month: number; day: number }

function parseParts(s: string): Parts | null {
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s)
  if (m) return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }
  m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(s)
  if (m) return { year: m[3] ? Number(m[3]) : undefined, month: Number(m[1]), day: Number(m[2]) }
  m = /^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?$/.exec(s)
  if (m) {
    const idx = MONTHS.indexOf(m[1].slice(0, 3))
    if (idx >= 0) return { year: m[3] ? Number(m[3]) : undefined, month: idx + 1, day: Number(m[2]) }
  }
  return null
}

/**
 * A due date as ISO (YYYY-MM-DD), or null when empty. Accepts YYYY-MM-DD, M/D[/YYYY] (US order),
 * "Dec 5" / "December 5 2026", "today" and "tomorrow". "Today" is the date in `zone`. With no year, this
 * year, or the next one if the date has passed. Past dates and dates more than 2 years ahead are refused.
 */
export function parseDue(raw: unknown, now: Date, zone: string = DEFAULT_CALL_TIME_ZONE): Checked<{ due: string | null }> {
  if (raw === undefined || raw === null) return { ok: true, due: null }
  if (typeof raw !== 'string') return { ok: false, error: 'Use a due date like 2026-12-05 or Dec 5.' }
  const s = raw.trim().toLowerCase()
  if (!s) return { ok: true, due: null }
  const t = wallTimeIn(now.getTime(), zone)
  const today = iso(t.year, t.month, t.day)
  const max = iso(t.year + MAX_YEARS_AHEAD, t.month, t.day)

  let due: string | null = null
  if (s === 'today') due = today
  else if (s === 'tomorrow') {
    const d = new Date(Date.UTC(t.year, t.month - 1, t.day + 1))
    due = iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
  } else {
    const p = parseParts(s)
    if (p) {
      if (p.year !== undefined) {
        if (isRealDate(p.year, p.month, p.day)) due = iso(p.year, p.month, p.day)
      } else {
        // No year: this year, else the next that has the date (Feb 29) and is not in the past.
        for (let y = t.year; y <= t.year + 4; y++) {
          if (isRealDate(y, p.month, p.day) && iso(y, p.month, p.day) >= today) {
            due = iso(y, p.month, p.day)
            break
          }
        }
      }
    }
  }
  if (!due) return { ok: false, error: 'I could not read that date. Use 2026-12-05, 12/5 (month first) or Dec 5.' }
  if (due < today) return { ok: false, error: 'That date has passed. Pick today or later.' }
  if (due > max) return { ok: false, error: `That date is more than ${MAX_YEARS_AHEAD} years away. Check the year.` }
  return { ok: true, due }
}
