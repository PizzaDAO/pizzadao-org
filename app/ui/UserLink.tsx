"use client";

import React, { useState, useEffect } from "react";

type UserLinkProps = {
  discordId: string;
  // spinach-65462: if the parent already knows the sheet memberId (e.g. the
  // server resolved it before sending the row), pass it in. We then link
  // directly to /profile/{memberId} on first paint instead of waiting for
  // the per-user `/api/member-lookup/{discordId}` round-trip, and we never
  // fall back to /profile/{discordSnowflake}.
  memberId?: string | null;
  style?: React.CSSProperties;
};

// Simple in-memory cache for user names and member IDs
const nameCache: Record<string, string> = {};
const memberIdCache: Record<string, string> = {};

/**
 * Text link to a member's profile. Uses foreground color by default,
 * shifts to tomato on hover with a 2px underline offset to match the
 * pizzadao.org link treatment.
 */
export function UserLink({ discordId, memberId: providedMemberId, style }: UserLinkProps) {
  const [name, setName] = useState<string | null>(nameCache[discordId] || null);
  const [memberId, setMemberId] = useState<string | null>(
    providedMemberId || memberIdCache[discordId] || null,
  );
  const [loading, setLoading] = useState(!nameCache[discordId]);

  // Seed the shared cache so other instances rendering the same Discord ID
  // also pick up the server-provided memberId without a fetch.
  useEffect(() => {
    if (providedMemberId) {
      memberIdCache[discordId] = providedMemberId;
      setMemberId(providedMemberId);
    }
  }, [discordId, providedMemberId]);

  useEffect(() => {
    if (nameCache[discordId]) {
      setName(nameCache[discordId]);
      if (!providedMemberId) {
        setMemberId(memberIdCache[discordId] || null);
      }
      setLoading(false);
      return;
    }

    const fetchName = async () => {
      try {
        const res = await fetch(`/api/member-lookup/${discordId}`);
        const data = await res.json();
        if (res.ok && data.data?.Name) {
          nameCache[discordId] = data.data.Name;
          setName(data.data.Name);
          if (data.memberId) {
            memberIdCache[discordId] = String(data.memberId);
            // Don't clobber an explicitly provided memberId — but if none
            // was provided, populate from the lookup response.
            if (!providedMemberId) setMemberId(String(data.memberId));
          }
        } else {
          // Fallback to truncated ID
          setName(discordId.slice(0, 8) + "...");
        }
      } catch {
        setName(discordId.slice(0, 8) + "...");
      } finally {
        setLoading(false);
      }
    };

    fetchName();
  }, [discordId, providedMemberId]);

  const displayName = loading ? discordId.slice(0, 8) + "..." : name;
  // spinach-65462: prefer the server-provided memberId, then the cached
  // memberId resolved via /api/member-lookup. ONLY fall back to discordId
  // when neither is known — and in that case, render a non-link span so we
  // never produce a broken /profile/{discordSnowflake} URL.
  const profileId = memberId;

  // No resolved memberId yet — render plain text so we don't link to a
  // broken /profile/{discordSnowflake} URL. The link will appear on the
  // next render once the lookup completes (or immediately if the parent
  // supplied a memberId).
  if (!profileId) {
    return (
      <span
        style={{
          color: "hsl(var(--foreground))",
          fontWeight: 600,
          ...style,
        }}
      >
        {displayName}
      </span>
    );
  }

  return (
    <a
      href={`/profile/${profileId}`}
      style={{
        color: "hsl(var(--foreground))",
        textDecoration: "none",
        fontWeight: 600,
        textUnderlineOffset: 2,
        transition: "color 150ms ease",
        ...style,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = "hsl(var(--tomato))";
        e.currentTarget.style.textDecoration = "underline";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = (style?.color as string) ?? "hsl(var(--foreground))";
        e.currentTarget.style.textDecoration = "none";
      }}
    >
      {displayName}
    </a>
  );
}
