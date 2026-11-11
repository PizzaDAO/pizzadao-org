/**
 * The Sesh grace window (plans/voting-golive-and-reminders.md A, B2).
 *
 * Once proposals are live, a payment request above the on-approval cap needs a passed in-app proposal. Requests
 * for Sesh polls that were already running at go-live would be stranded, so for a bounded time a request may
 * still use the old path (a Discord poll link plus the reviewer-confirmed ayes), but ONLY when the link is a
 * Discord message link whose message was posted before the go-live moment. A Discord id encodes its creation
 * time, so a poll posted after go-live can never use this path, whatever date is typed.
 */
import { loadSettings } from '@/app/lib/settings'
import { DAY_MS } from './constants'

const DISCORD_EPOCH_MS = 1420070400000
const LINK = /^https:\/\/(?:(?:ptb|canary)\.)?(?:discord|discordapp)\.com\/channels\/(\d{15,25})\/(\d{15,25})\/(\d{15,25})(?:[/?#].*)?$/i

/** The creation time of a Discord snowflake, or null when it is not one. */
export function snowflakeTime(id: string): Date | null {
  if (!/^\d{15,25}$/.test(id)) return null
  try {
    return new Date(Number(BigInt(id) / BigInt(4194304)) + DISCORD_EPOCH_MS)
  } catch {
    return null
  }
}

/** When the poll message in a Discord message link was posted, or null when the link is anything else. */
export function discordMessageLinkTime(url: string | null | undefined): Date | null {
  const m = typeof url === 'string' ? LINK.exec(url.trim()) : null
  return m ? snowflakeTime(m[3]) : null
}

/** The end of the window: the saved date (inclusive, UTC), else 30 days after go-live. Null without a go-live moment. */
export function graceEnd(liveSince: Date | null, untilDate: string): Date | null {
  if (untilDate && /^\d{4}-\d{2}-\d{2}$/.test(untilDate)) {
    const d = new Date(`${untilDate}T00:00:00Z`)
    if (!Number.isNaN(d.getTime())) return new Date(d.getTime() + DAY_MS)
  }
  return liveSince ? new Date(liveSince.getTime() + 30 * DAY_MS) : null
}

/** Pure. True when a legacy Sesh link may still back an over-cap request right now. Fails closed. */
export function legacySeshAllowed(url: string | null | undefined, liveSince: Date | null, untilDate: string, now: Date): boolean {
  if (!liveSince || Number.isNaN(liveSince.getTime())) return false
  const end = graceEnd(liveSince, untilDate)
  if (!end || now.getTime() >= end.getTime()) return false
  const posted = discordMessageLinkTime(url)
  return !!posted && posted.getTime() < liveSince.getTime()
}

export interface SeshWindow {
  liveSince: Date | null
  untilDate: string
}

/** The window settings. Unreadable settings give no window (the strict answer). Never throws. */
export async function loadSeshWindow(): Promise<SeshWindow> {
  try {
    const s = await loadSettings()
    if (s.readFailed) return { liveSince: null, untilDate: '' }
    const raw = s.get('proposals.liveSince')
    const t = raw ? new Date(raw) : null
    return { liveSince: t && !Number.isNaN(t.getTime()) ? t : null, untilDate: s.get('proposals.seshLinksUntil') }
  } catch {
    return { liveSince: null, untilDate: '' }
  }
}

/** True when the window is open at all (go-live happened and the end has not passed): the form keeps its Sesh field. */
export function seshWindowOpen(w: SeshWindow, now: Date): boolean {
  if (!w.liveSince) return false
  const end = graceEnd(w.liveSince, w.untilDate)
  return !!end && now.getTime() < end.getTime()
}
