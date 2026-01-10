"use client";

import React, { useState, useEffect } from "react";

type UserLinkProps = {
  discordId: string;
  style?: React.CSSProperties;
};

// Simple in-memory cache for user names
const nameCache: Record<string, string> = {};

export function UserLink({ discordId, style }: UserLinkProps) {
  const [name, setName] = useState<string | null>(nameCache[discordId] || null);
  const [loading, setLoading] = useState(!nameCache[discordId]);

  useEffect(() => {
    if (nameCache[discordId]) {
      setName(nameCache[discordId]);
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

  return (
    <a
      href={`/profile/${discordId}`}
      style={{
        color: "#2563eb",
        textDecoration: "none",
        fontWeight: 600,
        ...style,
      }}
    >
      {displayName}
    </a>
  );
}
