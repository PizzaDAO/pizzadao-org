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
 *   [text](https://…) markdown link (http/https only)
 *   https://…         bare URL
 *
 * Any other `<...>` that looks like Discord syntax but isn't one of the
 * above (a malformed mention, a timestamp tag `<t:...>`, etc.) is parsed as
 * an "unknown" token and dropped on render — raw Discord markup should
 * never reach the page.
 */

export type DiscordMarkupToken =
  | { type: "text"; text: string }
  | { type: "channel"; id: string; name: string | null }
  | { type: "role"; id: string; name: string | null }
  | { type: "user"; id: string }
  | { type: "emoji"; id: string; name: string; animated: boolean }
  | { type: "link"; href: string; text: string }
  | { type: "unknown"; raw: string }

export interface DiscordMarkupMaps {
  /** channel id -> channel name (no leading "#") */
  channels?: Record<string, string>
  /** role id -> role name (no leading "@") */
  roles?: Record<string, string>
}

const SNOWFLAKE = "\\d{5,25}"

// Alternatives, tried left to right at each position; capture groups below
// map 1:1 to the branches (link text/href, emoji animated flag/name/id,
// channel id, role id, user id, bare url).
const TOKEN_RE = new RegExp(
  [
    `\\[([^\\]\\n]+)\\]\\((https?:\\/\\/[^\\s)]+)\\)`, // [text](href)
    `<(a)?:([A-Za-z0-9_~]+):(${SNOWFLAKE})>`, // <:name:id> / <a:name:id>
    `<#(${SNOWFLAKE})>`, // <#channelId>
    `<@&(${SNOWFLAKE})>`, // <@&roleId>
    `<@!?(${SNOWFLAKE})>`, // <@userId> / <@!userId>
    `(https?:\\/\\/[^\\s<>\\[\\]]+)`, // bare url
    `(<(?:@[!&]?\\d*|#\\d*|a?:[A-Za-z0-9_~]*:\\d*|t:\\d+(?::[a-zA-Z])?)>)`, // any other Discord-shaped tag — stripped
  ].join("|"),
  "g",
)

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

    const [, linkText, linkHref, emojiAnimated, emojiName, emojiId, channelId, roleId, userId, bareUrl, unknownTag] =
      match

    if (linkHref !== undefined) {
      tokens.push({ type: "link", href: linkHref, text: linkText })
    } else if (emojiId !== undefined) {
      tokens.push({ type: "emoji", id: emojiId, name: emojiName, animated: emojiAnimated === "a" })
    } else if (channelId !== undefined) {
      tokens.push({ type: "channel", id: channelId, name: maps.channels?.[channelId] ?? null })
    } else if (roleId !== undefined) {
      tokens.push({ type: "role", id: roleId, name: maps.roles?.[roleId] ?? null })
    } else if (userId !== undefined) {
      tokens.push({ type: "user", id: userId })
    } else if (bareUrl !== undefined) {
      tokens.push({ type: "link", href: bareUrl, text: bareUrl })
    } else if (unknownTag !== undefined) {
      tokens.push({ type: "unknown", raw: unknownTag })
    }

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    tokens.push({ type: "text", text: text.slice(lastIndex) })
  }

  return tokens
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
