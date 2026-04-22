"use client";
import { useEffect, useState } from "react";

export function MafiaRankBadge({ memberId }: { memberId: string }) {
  const [rank, setRank] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/mafia-points/${memberId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => data?.rank && setRank(data.rank))
      .catch(() => {});
  }, [memberId]);

  if (!rank) return null;

  return (
    <div className="text-xs">
      <span className="text-zinc-500 dark:text-zinc-400">Pizza Mafia Rank</span>
      <p className="font-semibold text-amber-700 dark:text-amber-300">{rank}</p>
    </div>
  );
}
