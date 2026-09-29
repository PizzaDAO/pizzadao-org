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
 *
 * Phase 3c restyle: subtle ink chips on cream-warm background that
 * shift to tomato on hover, matching the pizzadao.org accent style.
 *
 * Layout-leak fix (truffle-91035 PR1): the component used to own its
 * outer `sm:col-span-2` wrapper, which forced it to span two columns
 * of its parent grid regardless of where it was placed. The `variant`
 * prop now decouples that. `"standalone"` (default) preserves the
 * outer wrapper — keeping all current call sites visually identical
 * to main. `"inline"` drops the wrapper so the parent owns layout.
 */
export function ProfileLinksDisplay({
  memberId,
  variant = "standalone",
}: {
  memberId: string;
  /**
   * Visual variant.
   * - `"standalone"` (default): renders inside an `sm:col-span-2` wrapper,
   *   identical to the pre-refactor behavior.
   * - `"inline"`: renders without the outer grid-spanning wrapper. Use when
   *   the parent owns the section layout.
   */
  variant?: "standalone" | "inline";
}) {
  const [links, setLinks] = useState<ProfileLink[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(
          `/api/profile-links?memberId=${encodeURIComponent(memberId)}`,
        );
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

  const body = (
    <>
      <h3 className="m-0 mb-2 text-xs uppercase tracking-wider font-bold text-muted-foreground">
        Links
      </h3>
      <div className="flex flex-wrap gap-2">
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
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[--radius] border border-rule text-foreground no-underline text-sm font-medium transition-colors hover:border-tomato hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              style={{ background: "hsl(var(--background))" }}
            >
              <span className="text-base">{link.emoji}</span>
              <span>{displayText}</span>
            </a>
          );
        })}
      </div>
    </>
  );

  if (variant === "inline") {
    return body;
  }

  return <div className="sm:col-span-2">{body}</div>;
}
