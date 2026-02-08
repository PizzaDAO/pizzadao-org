"use client";

import { useEffect, useState } from "react";

type ProfileLink = {
  id: number;
  emoji: string;
  url: string;
  label: string | null;
};

/**
 * Read-only display of profile links on the public profile page.
 * Shows emoji + link in a clean horizontal/wrap layout.
 */
export function ProfileLinksDisplay({ memberId }: { memberId: string }) {
  const [links, setLinks] = useState<ProfileLink[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/profile-links?memberId=${encodeURIComponent(memberId)}`);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.links)) {
            setLinks(data.links);
          }
        }
      } catch {
        // silently fail - links are optional
      } finally {
        setLoading(false);
      }
    })();
  }, [memberId]);

  if (loading || links.length === 0) return null;

  return (
    <div style={{ gridColumn: "1 / -1" }}>
      <h3
        style={{
          fontSize: 12,
          textTransform: "uppercase",
          letterSpacing: "1px",
          opacity: 0.5,
          marginTop: 0,
          marginBottom: 8,
          fontWeight: 700,
        }}
      >
        Links
      </h3>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {links.map((link) => {
          // Derive display text: use label if set, otherwise show the hostname
          let displayText = link.label;
          if (!displayText) {
            try {
              displayText = new URL(link.url).hostname.replace(/^www\./, "");
            } catch {
              displayText = link.url;
            }
          }

          return (
            <a
              key={link.id}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                borderRadius: 10,
                border: "1px solid rgba(0,0,0,0.12)",
                background: "white",
                color: "#111",
                textDecoration: "none",
                fontSize: 14,
                fontWeight: 500,
                transition: "border-color 0.15s, box-shadow 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "rgba(0,0,0,0.3)";
                e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.08)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "rgba(0,0,0,0.12)";
                e.currentTarget.style.boxShadow = "none";
              }}
            >
              <span style={{ fontSize: 16 }}>{link.emoji}</span>
              <span>{displayText}</span>
            </a>
          );
        })}
      </div>
    </div>
  );
}
