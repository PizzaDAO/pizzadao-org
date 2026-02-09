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
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        minHeight: 44,
        padding: "6px 0",
        borderBottom: '1px solid var(--color-divider)',
      }}
    >
      {/* Rank */}
      <span
        style={{
          width: 24,
          textAlign: "center",
          fontSize: 14,
          fontWeight: 500,
          color: 'var(--color-text-secondary)',
        }}
      >
        {rank}
      </span>

      {/* Name (link to profile) */}
      <Link
        href={`/profile/${memberId}`}
        style={{
          flex: 1,
          fontSize: 14,
          fontWeight: 500,
          color: 'var(--color-text-primary)',
          textDecoration: "none",
          display: "flex",
          alignItems: "center",
          minHeight: 44,
        }}
      >
        {memberName}
      </Link>

      {/* Turtle badges */}
      <div style={{ display: "flex", gap: 4 }}>
        {turtleImages.map((t) => (
          <img
            key={t.id}
            src={t.image}
            alt={t.id}
            title={t.id}
            style={{
              width: 24,
              height: 24,
              borderRadius: "50%",
            }}
          />
        ))}
      </div>

      {/* NFT count */}
      <span
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: 'var(--color-text-primary)',
          minWidth: 32,
          textAlign: "right",
        }}
      >
        {nftCount}
      </span>
    </div>
  );
}
