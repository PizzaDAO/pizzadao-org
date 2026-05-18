"use client";

import React, { useState, useEffect } from "react";

type UserLinkProps = {
  discordId: string;
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
export function UserLink({ discordId, style }: UserLinkProps) {
  const [name, setName] = useState<string | null>(nameCache[discordId] || null);
  const [memberId, setMemberId] = useState<string | null>(memberIdCache[discordId] || null);
  const [loading, setLoading] = useState(!nameCache[discordId]);

  useEffect(() => {
    if (nameCache[discordId]) {
      setName(nameCache[discordId]);
      setMemberId(memberIdCache[discordId] || null);
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
            setMemberId(String(data.memberId));
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
  }, [discordId]);

  const displayName = loading ? discordId.slice(0, 8) + "..." : name;
  // Use memberId for profile link if available, fall back to discordId
  const profileId = memberId || discordId;

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
