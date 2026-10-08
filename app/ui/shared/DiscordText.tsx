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

import React from "react";
import { parseDiscordMarkup } from "@/app/lib/discord-markup";

export type DiscordTextProps = {
  text: string;
  /** channel id -> channel name, as resolved server-side */
  channels?: Record<string, string>;
  /** role id -> role name, as resolved server-side */
  roles?: Record<string, string>;
  /** guild id, used to build discord.com/channels/<guild>/<id> links */
  guildId?: string | null;
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

// Job/bounty descriptions render inside other clickable elements (the whole
// JobCard is a <button>; the Discover preview tiles are wrapped in a <Link>).
// Stop the click here so it never bubbles to that ancestor's handler — a tap
// on a mention link should open the link, not also complete the job or
// navigate the card away.
function stopPropagation(e: React.SyntheticEvent) {
  e.stopPropagation();
}

export function DiscordText({ text, channels, roles, guildId, className }: DiscordTextProps) {
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
            return (
              <a
                key={i}
                href={token.href}
                target="_blank"
                rel="noopener noreferrer"
                style={linkStyle}
                onClick={stopPropagation}
              >
                {token.text}
              </a>
            );

          case "channel": {
            const label = token.name ? `#${token.name}` : "#channel";
            if (!guildId) return <React.Fragment key={i}>{label}</React.Fragment>;
            return (
              <a
                key={i}
                href={`https://discord.com/channels/${guildId}/${token.id}`}
                target="_blank"
                rel="noopener noreferrer"
                style={channelLinkStyle}
                onClick={stopPropagation}
              >
                {label}
              </a>
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

          case "unknown":
            // Discord syntax we don't render (malformed mention, timestamp
            // tag, etc.) — stripped rather than shown raw.
            return null;

          default:
            return null;
        }
      })}
    </span>
  );
}
