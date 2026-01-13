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

export function HolderLeaderboard({
  holders,
  maxVisible = 8,
}: HolderLeaderboardProps) {
  const [expanded, setExpanded] = useState(false);

  const displayedHolders = expanded ? holders : holders.slice(0, maxVisible);
  const hasMore = holders.length > maxVisible;

  if (holders.length === 0) {
    return (
      <p style={{ fontSize: 14, color: "#666", margin: 0 }}>
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
          style={{
            marginTop: 12,
            padding: "8px 16px",
            fontSize: 14,
            fontWeight: 500,
            color: "#666",
            background: "rgba(0,0,0,0.04)",
            border: "none",
            borderRadius: 8,
            cursor: "pointer",
            width: "100%",
          }}
        >
          {expanded
            ? "Show Less"
            : `View More (${holders.length - maxVisible} more)`}
        </button>
      )}
    </div>
  );
}
