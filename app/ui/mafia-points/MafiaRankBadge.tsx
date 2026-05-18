"use client";
import { useEffect, useState } from "react";

/**
 * Pizza Mafia rank badge shown next to a member's name on their profile.
 *
 * Phase 3c restyle: switched zinc/amber Tailwind classes to semantic tokens
 * so the badge reads correctly on the ink hero (cream-on-ink) and would
 * still read on a cream surface (ink/butter accent) — caller context wins
 * via `currentColor` and tomato accent for the rank.
 */
export function MafiaRankBadge({ memberId }: { memberId: string }) {
  const [rank, setRank] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/mafia-points/${memberId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => data?.rank && setRank(data.rank))
      .catch(() => {});
  }, [memberId]);

  if (!rank) return null;

  return (
    <div className="text-xs leading-tight">
      <span className="opacity-60 uppercase tracking-wider text-[10px] font-semibold">
        Pizza Mafia Rank
      </span>
      <p
        className="font-display font-bold text-sm m-0"
        style={{ color: "hsl(var(--butter))" }}
      >
        {rank}
      </p>
    </div>
  );
}
