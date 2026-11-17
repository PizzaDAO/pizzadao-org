/**
 * Pure helpers that tidy Discord-sourced names for display (client-safe, no
 * I/O). Channel names often carry decoration ("🍕・general"); guild member
 * names are raw nicks, global names or handles.
 */
import { sanitizeDisplayName } from "./display-name"
import { realNick } from "./trainee-nick"

// Emoji, symbols, whitespace and the separators servers put around channel names.
const DECORATION = "[\\p{Extended_Pictographic}\\p{S}\\s\\uFE0F\\u200D\\u30FB|\\u2503\\u2502\\uFE31\\uFF5C\\u2022\\u00B7\\u2023-]"
const LEADING = new RegExp(`^${DECORATION}+`, "u")
const TRAILING = new RegExp(`${DECORATION}+$`, "u")

/** "🍕・general" -> "general". Keeps the inner name as is; returns the raw name when nothing is left. */
export function cleanChannelName(raw: string): string {
  const cleaned = raw.replace(LEADING, "").replace(TRAILING, "")
  return cleaned || raw.trim()
}

/**
 * The first guild-member candidate (nick, global name, username) that is
 * non-empty after dropping the Pizza Trainee placeholder and normalising with
 * `sanitizeDisplayName`. Null when none is usable.
 */
export function cleanGuildName(
  nick?: string | null,
  globalName?: string | null,
  username?: string | null,
): string | null {
  for (const candidate of [realNick(nick), realNick(globalName), realNick(username)]) {
    if (!candidate) continue
    const name = sanitizeDisplayName(candidate)
    if (name) return name
  }
  return null
}
