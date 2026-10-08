"use client";

// Renders Discord-sourced text (job/bounty descriptions pulled straight
// from a Discord message) with its markup turned into real UI instead of
// raw `<#id>` / `<@&id>` / `<:emoji:id>` tokens. Parsing is done by the pure
// `parseDiscordMarkup` helper; this component only maps tokens to React
// nodes — no `dangerouslySetInnerHTML`.
//
// Channel/role id -> name maps and the guild id come from the API that
// served the text (see app/lib/discord-mention-resolve.ts) so this
// component never needs the bot token.
//
// `interactive` (default true) controls whether channel mentions / links
// render as real anchors:
//   - true: real <a> elements. The anchors set `pointerEvents: "auto"` so
//     they keep working when a consumer wraps the whole description in a
//     `pointer-events: none` layer to implement a "stretched button" (the
//     rest of a card is one big click target; only these anchors should
//     intercept the click) — see app/ui/jobs/JobCard.tsx.
//   - false: styled <span>s, not links. Use this when the description
//     already sits inside another link/button that is the card's single
//     click target (e.g. the Discover dashboard preview tiles, which link
//     the whole tile to /pep) — nesting a real anchor in there would be
//     invalid HTML and fight the outer click target.

import React from "react";
import { parseDiscordMarkup, formatDiscordTimestamp } from "@/app/lib/discord-markup";

export type DiscordTextProps = {
  text: string;
  /** channel id -> channel name, as resolved server-side */
  channels?: Record<string, string>;
  /** role id -> role name, as resolved server-side */
  roles?: Record<string, string>;
  /** guild id, used to build discord.com/channels/<guild>/<id> links */
  guildId?: string | null;
  /** render channel mentions/links as real anchors (default true) */
  interactive?: boolean;
  className?: string;
};

const linkStyle: React.CSSProperties = {
  color: "hsl(var(--tomato))",
  textDecoration: "underline",
  textDecorationColor: "hsl(var(--tomato) / 0.4)",
};

const channelLinkStyle: React.CSSProperties = {
  color: "hsl(var(--tomato))",
  textDecoration: "none",
  fontWeight: 600,
};

const rolePillStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "0 6px",
  borderRadius: 4,
  background: "hsl(var(--muted))",
  color: "hsl(var(--foreground))",
  fontWeight: 600,
  fontSize: "0.95em",
};

const emojiStyle: React.CSSProperties = {
  height: "1.2em",
  width: "1.2em",
  verticalAlign: "-0.2em",
  display: "inline-block",
};

/**
 * A custom emoji image. If the CDN 404s (deleted/renamed emoji, bad id) it
 * hides itself entirely on error — no broken-image icon, no alt text, no
 * raw `<:name:id>` left behind.
 */
function DiscordEmoji({ id, name, animated }: { id: string; name: string; animated: boolean }) {
  const [failed, setFailed] = React.useState(false);
  if (failed) return null;
  return (
    <img
      src={`https://cdn.discordapp.com/emojis/${id}.${animated ? "gif" : "png"}`}
      alt={`:${name}:`}
      style={emojiStyle}
      onError={() => setFailed(true)}
    />
  );
}

export function DiscordText({
  text,
  channels,
  roles,
  guildId,
  interactive = true,
  className,
}: DiscordTextProps) {
  const tokens = React.useMemo(
    () => parseDiscordMarkup(text, { channels, roles }),
    [text, channels, roles],
  );

  return (
    <span className={className}>
      {tokens.map((token, i) => {
        switch (token.type) {
          case "text":
            return <React.Fragment key={i}>{token.text}</React.Fragment>;

          case "link":
            if (!interactive) {
              return (
                <span key={i} style={linkStyle}>
                  {token.text}
                </span>
              );
            }
            return (
              <a
                key={i}
                href={token.href}
                target="_blank"
                rel="noopener noreferrer"
                style={{ ...linkStyle, pointerEvents: "auto" }}
              >
                {token.text}
              </a>
            );

          case "channel": {
            const label = token.name ? `#${token.name}` : "#channel";
            if (interactive && guildId) {
              return (
                <a
                  key={i}
                  href={`https://discord.com/channels/${guildId}/${token.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ ...channelLinkStyle, pointerEvents: "auto" }}
                >
                  {label}
                </a>
              );
            }
            if (interactive) {
              // No guild id to link to — plain text, not styled as a link.
              return <React.Fragment key={i}>{label}</React.Fragment>;
            }
            return (
              <span key={i} style={channelLinkStyle}>
                {label}
              </span>
            );
          }

          case "role":
            return (
              <span key={i} style={rolePillStyle}>
                {token.name ? `@${token.name}` : "@role"}
              </span>
            );

          case "user":
            return (
              <span key={i} style={{ fontWeight: 600 }}>
                @user
              </span>
            );

          case "emoji":
            return <DiscordEmoji key={i} id={token.id} name={token.name} animated={token.animated} />;

          case "timestamp":
            return (
              <time key={i} dateTime={new Date(token.unix * 1000).toISOString()}>
                {formatDiscordTimestamp(token.unix, token.style)}
              </time>
            );

          case "unknown":
            // Discord syntax we don't render (malformed mention, timestamp
            // tag, slash-command mention, etc.) — stripped rather than
            // shown raw.
            return null;

          default:
            return null;
        }
      })}
    </span>
  );
}
