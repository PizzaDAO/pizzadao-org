/**
 * Pure parser for Discord message markup embedded in job/bounty
 * descriptions pulled from Discord (channel/role/user mentions, custom
 * emoji, markdown links, bare URLs). No network access, no React — just
 * text in, tokens out. `app/ui/shared/DiscordText.tsx` turns these tokens
 * into React nodes; `app/lib/discord-mention-resolve.ts` resolves the
 * channel/role id -> name maps this parser accepts.
 *
 * Recognized forms:
 *   <#123>            channel mention
 *   <@&123>           role mention
 *   <@123> / <@!123>  user mention (nickname form)
 *   <:name:123>       custom emoji
 *   <a:name:123>      animated custom emoji
 *   [text](https://…) markdown link (http/https only; one level of balanced
 *                      parens allowed in the href, e.g. a wikipedia
 *                      `Foo_(bar)` URL; the link TEXT is itself scanned for
 *                      markup so a mention/emoji tag inside `[...]` never
 *                      shows up raw)
 *   https://…         bare URL (trailing `.,;:!?)` is trimmed unless the
 *                      `)` balances a `(` earlier in the URL)
 *   <t:UNIX>          Discord timestamp, default style "f"
 *   <t:UNIX:STYLE>    Discord timestamp, STYLE one of t/T/d/D/f/F/R — see
 *                      `formatDiscordTimestamp` for what each one renders
 *                      as. Rendered as a formatted date/time (in the
 *                      viewer's own locale, via `Intl`) instead of being
 *                      stripped.
 *
 * Any other `<...>` that looks like Discord syntax but isn't one of the
 * above — a malformed mention, a malformed timestamp tag (bad style letter,
 * e.g. `<t:123:Z>`), a slash-command mention `</cmd subcommand:id>`, a
 * guide/onboarding tag `<id:customize>`, etc. — is parsed as an "unknown"
 * token and dropped on render. Raw Discord markup should never reach the
 * page.
 */

export type TimestampStyle = "t" | "T" | "d" | "D" | "f" | "F" | "R"

export type DiscordMarkupToken =
  | { type: "text"; text: string }
  | { type: "channel"; id: string; name: string | null }
  | { type: "role"; id: string; name: string | null }
  | { type: "user"; id: string }
  | { type: "emoji"; id: string; name: string; animated: boolean }
  | { type: "link"; href: string; text: string }
  | { type: "timestamp"; unix: number; style: TimestampStyle }
  | { type: "unknown"; raw: string }

export interface DiscordMarkupMaps {
  /** channel id -> channel name (no leading "#") */
  channels?: Record<string, string>
  /** role id -> role name (no leading "@") */
  roles?: Record<string, string>
}

const SNOWFLAKE = "\\d{5,25}"

// One level of balanced parens allowed inside a markdown link href, e.g.
// https://en.wikipedia.org/wiki/Foo_(bar) — the outer alternation still
// stops at the markdown's own closing ")".
const HREF_WITH_BALANCED_PARENS = `https?:\\/\\/(?:\\([^\\s()]*\\)|[^\\s()])+`

// Other Discord-shaped tags we recognize but don't render — stripped
// rather than shown raw. Order doesn't matter here since these never
// overlap with the specific forms above (tried first in TOKEN_RE).
const UNKNOWN_TAG_INNER = [
  `@[!&]?\\d*`, // malformed user/role mention (id too short, etc.)
  `#\\d*`, // malformed channel mention
  `a?:[A-Za-z0-9_~]*:\\d*`, // malformed/empty emoji
  `t:\\d+(?::[a-zA-Z])?`, // timestamp tag <t:unix:FORMAT>
  `\\/[^<>\\n]+?:${SNOWFLAKE}`, // slash-command mention </cmd sub:id>
  `id:[A-Za-z_]+`, // guide/onboarding tag <id:customize|browse|guide|...>
].join("|")

// Alternatives, tried left to right at each position; capture groups below
// map 1:1 to the branches (link text/href, emoji animated flag/name/id,
// channel id, role id, user id, timestamp unix/style, bare url, unknown tag).
//
// The timestamp branch is listed before the generic "unknown tag" fallback
// so a *valid* `<t:unix>` / `<t:unix:STYLE>` is captured specifically;
// anything timestamp-shaped but malformed (bad style letter, etc.) falls
// through to the unknown-tag branch at the end and is stripped as before.
const TOKEN_RE = new RegExp(
  [
    `\\[([^\\]\\n]+)\\]\\((${HREF_WITH_BALANCED_PARENS})\\)`, // [text](href)
    `<(a)?:([A-Za-z0-9_~]+):(${SNOWFLAKE})>`, // <:name:id> / <a:name:id>
    `<#(${SNOWFLAKE})>`, // <#channelId>
    `<@&(${SNOWFLAKE})>`, // <@&roleId>
    `<@!?(${SNOWFLAKE})>`, // <@userId> / <@!userId>
    `<t:(\\d+)(?::([tTdDfFR]))?>`, // <t:unix> / <t:unix:STYLE>
    `(https?:\\/\\/[^\\s<>\\[\\]]+)`, // bare url (trimmed below)
    `(<(?:${UNKNOWN_TAG_INNER})>)`, // any other Discord-shaped tag — stripped
  ].join("|"),
  "g",
)

/** Trim trailing sentence punctuation from a bare URL match; keeps a
 * trailing ")" when it balances an earlier "(" inside the URL itself
 * (e.g. a wikipedia `Foo_(bar)` link typed as a bare URL). */
function trimTrailingPunctuation(url: string): string {
  let end = url.length
  while (end > 0) {
    const ch = url[end - 1]
    if (".,;:!?".includes(ch)) {
      end--
      continue
    }
    if (ch === ")") {
      const prefix = url.slice(0, end - 1)
      const opens = (prefix.match(/\(/g) || []).length
      const closes = (prefix.match(/\)/g) || []).length
      if (opens > closes) break // balances an earlier "(" — keep it
      end--
      continue
    }
    break
  }
  return url.slice(0, end)
}

/** Parse `text` into renderable tokens, resolving mentions via `maps` when possible. */
export function parseDiscordMarkup(text: string, maps: DiscordMarkupMaps = {}): DiscordMarkupToken[] {
  const tokens: DiscordMarkupToken[] = []
  if (!text) return tokens

  const re = new RegExp(TOKEN_RE)
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = re.exec(text))) {
    // A zero-length match can't happen with these patterns, but guard
    // against an infinite loop regardless.
    if (match[0].length === 0) {
      re.lastIndex++
      continue
    }

    if (match.index > lastIndex) {
      tokens.push({ type: "text", text: text.slice(lastIndex, match.index) })
    }

    const [
      ,
      linkText,
      linkHref,
      emojiAnimated,
      emojiName,
      emojiId,
      channelId,
      roleId,
      userId,
      timestampUnix,
      timestampStyle,
      rawBareUrl,
      unknownTag,
    ] = match

    let matchEnd = match.index + match[0].length

    if (linkHref !== undefined) {
      // The link TEXT can itself contain markup (a mention, an emoji tag,
      // ...) — flatten it to plain text so nothing raw shows inside the
      // anchor's label.
      const cleanedText = discordMarkupToPlainText(parseDiscordMarkup(linkText, maps), maps)
      tokens.push({ type: "link", href: linkHref, text: cleanedText })
    } else if (emojiId !== undefined) {
      tokens.push({ type: "emoji", id: emojiId, name: emojiName, animated: emojiAnimated === "a" })
    } else if (channelId !== undefined) {
      tokens.push({ type: "channel", id: channelId, name: maps.channels?.[channelId] ?? null })
    } else if (roleId !== undefined) {
      tokens.push({ type: "role", id: roleId, name: maps.roles?.[roleId] ?? null })
    } else if (userId !== undefined) {
      tokens.push({ type: "user", id: userId })
    } else if (timestampUnix !== undefined) {
      tokens.push({
        type: "timestamp",
        unix: Number(timestampUnix),
        style: (timestampStyle as TimestampStyle | undefined) ?? "f",
      })
    } else if (rawBareUrl !== undefined) {
      const trimmed = trimTrailingPunctuation(rawBareUrl)
      tokens.push({ type: "link", href: trimmed, text: trimmed })
      // The trimmed-off trailing punctuation (if any) falls back into the
      // surrounding plain text instead of being consumed by the link.
      matchEnd = match.index + trimmed.length
    } else if (unknownTag !== undefined) {
      tokens.push({ type: "unknown", raw: unknownTag })
    }

    lastIndex = matchEnd
  }

  if (lastIndex < text.length) {
    tokens.push({ type: "text", text: text.slice(lastIndex) })
  }

  return tokens
}

// Intl.DateTimeFormat options for each absolute Discord timestamp style,
// matching what Discord's own client shows for that style (but in the
// viewer's own locale via Intl, rather than Discord's fixed US-English
// rendering):
//   t  short time       9:01 AM
//   T  long time        9:01:00 AM
//   d  short date       11/28/2018
//   D  long date        November 28, 2018
//   f  short date/time  November 28, 2018 9:01 AM   (default style)
//   F  long date/time   Wednesday, November 28, 2018 9:01 AM
const TIMESTAMP_DATE_FORMAT_OPTIONS: Record<Exclude<TimestampStyle, "R">, Intl.DateTimeFormatOptions> = {
  t: { hour: "numeric", minute: "2-digit" },
  T: { hour: "numeric", minute: "2-digit", second: "2-digit" },
  d: { year: "numeric", month: "numeric", day: "numeric" },
  D: { year: "numeric", month: "long", day: "numeric" },
  f: { year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" },
  F: { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" },
}

// Largest-unit-first thresholds for Intl.RelativeTimeFormat, the standard
// "divide down" recipe: keep dividing the delta by each unit's size until
// it's smaller than the next unit, then format in that unit.
const RELATIVE_DIVISIONS: Array<{ amount: number; unit: Intl.RelativeTimeFormatUnit }> = [
  { amount: 60, unit: "seconds" },
  { amount: 60, unit: "minutes" },
  { amount: 24, unit: "hours" },
  { amount: 7, unit: "days" },
  { amount: 4.34524, unit: "weeks" },
  { amount: 12, unit: "months" },
  { amount: Number.POSITIVE_INFINITY, unit: "years" },
]

function formatRelativeTimestamp(unixSeconds: number, nowMs: number): string {
  let duration = (unixSeconds * 1000 - nowMs) / 1000 // seconds; positive = future
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })
  for (const division of RELATIVE_DIVISIONS) {
    if (Math.abs(duration) < division.amount) {
      return rtf.format(Math.round(duration), division.unit)
    }
    duration /= division.amount
  }
  return rtf.format(Math.round(duration), "years")
}

/**
 * Format a Discord `<t:UNIX>` / `<t:UNIX:STYLE>` timestamp as a string,
 * using `Intl` with no explicit locale so it renders in the viewer's own
 * locale (both here and in `DiscordText`'s `<time>` element — same call,
 * same string). `now` is injectable for tests; defaults to `Date.now()`.
 */
export function formatDiscordTimestamp(
  unixSeconds: number,
  style: TimestampStyle = "f",
  now: number = Date.now(),
): string {
  if (style === "R") return formatRelativeTimestamp(unixSeconds, now)
  const date = new Date(unixSeconds * 1000)
  return new Intl.DateTimeFormat(undefined, TIMESTAMP_DATE_FORMAT_OPTIONS[style]).format(date)
}

/**
 * Flatten parsed tokens to a plain-text string — `#name`, `@name`, `@user`,
 * a link's text, `:name:` for an emoji, a formatted date/time for a
 * timestamp, and nothing for a dropped/unknown tag. For use anywhere a
 * description needs to go into an aria-label, title, or other
 * non-visual/plain-text context. `maps` is an optional fallback in case a
 * token wasn't resolved when it was parsed.
 */
export function discordMarkupToPlainText(tokens: DiscordMarkupToken[], maps: DiscordMarkupMaps = {}): string {
  return tokens
    .map((token) => {
      switch (token.type) {
        case "text":
          return token.text
        case "channel":
          return `#${token.name ?? maps.channels?.[token.id] ?? "channel"}`
        case "role":
          return `@${token.name ?? maps.roles?.[token.id] ?? "role"}`
        case "user":
          return "@user"
        case "emoji":
          return `:${token.name}:`
        case "link":
          return token.text
        case "timestamp":
          return formatDiscordTimestamp(token.unix, token.style)
        case "unknown":
          return ""
        default:
          return ""
      }
    })
    .join("")
}

/** Parse `text` and flatten it to plain text in one step (see `discordMarkupToPlainText`). */
export function discordTextToPlainText(text: string, maps: DiscordMarkupMaps = {}): string {
  return discordMarkupToPlainText(parseDiscordMarkup(text, maps), maps)
}

/** Channel and role ids mentioned in `text` (deduped), for resolving names. */
export function extractMentionIds(text: string): { channelIds: string[]; roleIds: string[] } {
  const channelIds = new Set<string>()
  const roleIds = new Set<string>()
  const re = new RegExp(`<#(${SNOWFLAKE})>|<@&(${SNOWFLAKE})>`, "g")
  let match: RegExpExecArray | null
  while ((match = re.exec(text))) {
    if (match[1]) channelIds.add(match[1])
    if (match[2]) roleIds.add(match[2])
  }
  return { channelIds: [...channelIds], roleIds: [...roleIds] }
}

/** Same as `extractMentionIds`, merged across several descriptions. */
export function extractMentionIdsFromAll(texts: string[]): { channelIds: string[]; roleIds: string[] } {
  const channelIds = new Set<string>()
  const roleIds = new Set<string>()
  for (const text of texts) {
    const found = extractMentionIds(text)
    found.channelIds.forEach((id) => channelIds.add(id))
    found.roleIds.forEach((id) => roleIds.add(id))
  }
  return { channelIds: [...channelIds], roleIds: [...roleIds] }
}
