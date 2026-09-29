"use client";

import Link from "next/link";
import { TURTLES } from "../constants";

interface HolderRowProps {
  rank: number;
  memberId: string;
  memberName: string;
  nftCount: number;
  turtles: string[];
}

/**
 * HolderRow — capers-48272 (Phase 4e restyle)
 * Rank | name (linked) | turtle badges | NFT count.
 * Rank + count in Asap Condensed; name uses tomato hover.
 */
export function HolderRow({
  rank,
  memberId,
  memberName,
  nftCount,
  turtles,
}: HolderRowProps) {
  // Map turtle names to their image paths
  const turtleImages = turtles
    .map((t) => {
      const turtle = TURTLES.find(
        (tt) => tt.id.toLowerCase() === t.toLowerCase()
      );
      return turtle ? { id: turtle.id, image: turtle.image } : null;
    })
    .filter(Boolean) as { id: string; image: string }[];

  return (
    <div className="flex items-center gap-3 min-h-[44px] py-1.5 border-b border-rule">
      {/* Rank — Asap Condensed */}
      <span className="w-6 text-center font-display text-sm font-semibold text-muted-foreground">
        {rank}
      </span>

      {/* Name (link to profile) — tomato hover */}
      <Link
        href={`/profile/${memberId}`}
        className="flex-1 flex items-center min-h-[44px] text-sm font-medium text-foreground hover:text-tomato no-underline transition-colors"
      >
        {memberName}
      </Link>

      {/* Turtle badges */}
      <div className="flex gap-1">
        {turtleImages.map((t) => (
          <img
            key={t.id}
            src={t.image}
            alt={t.id}
            title={t.id}
            className="w-6 h-6 rounded-full border border-rule"
          />
        ))}
      </div>

      {/* NFT count — Asap Condensed */}
      <span className="font-display text-sm font-semibold text-foreground min-w-[32px] text-right">
        {nftCount}
      </span>
    </div>
  );
}
