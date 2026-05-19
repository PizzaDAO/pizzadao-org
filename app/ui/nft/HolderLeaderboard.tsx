"use client";

import { useState } from "react";
import { HolderRow } from "./HolderRow";

interface Holder {
  memberId: string;
  memberName: string;
  nftCount: number;
  turtles: string[];
}

interface HolderLeaderboardProps {
  holders: Holder[];
  maxVisible?: number;
}

/**
 * HolderLeaderboard — capers-48272 (Phase 4e restyle)
 * Stacked ranked list of members holding a collection, with a
 * "View More" toggle. Empty state is muted-foreground italic.
 */
export function HolderLeaderboard({
  holders,
  maxVisible = 8,
}: HolderLeaderboardProps) {
  const [expanded, setExpanded] = useState(false);

  const displayedHolders = expanded ? holders : holders.slice(0, maxVisible);
  const hasMore = holders.length > maxVisible;

  if (holders.length === 0) {
    return (
      <p className="m-0 text-sm text-muted-foreground italic text-center py-4">
        No registered members hold this collection
      </p>
    );
  }

  return (
    <div>
      <div>
        {displayedHolders.map((holder, idx) => (
          <HolderRow
            key={holder.memberId}
            rank={idx + 1}
            memberId={holder.memberId}
            memberName={holder.memberName}
            nftCount={holder.nftCount}
            turtles={holder.turtles}
          />
        ))}
      </div>

      {hasMore && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-3 w-full min-h-[44px] px-4 py-3 rounded-[var(--radius)] font-display text-sm font-semibold text-foreground bg-muted hover:bg-tomato/10 hover:text-tomato border border-rule transition-colors cursor-pointer"
        >
          {expanded
            ? "Show Less"
            : `View More (${holders.length - maxVisible} more)`}
        </button>
      )}
    </div>
  );
}
