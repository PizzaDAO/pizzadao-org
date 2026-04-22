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
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
      {rank}
    </span>
  );
}
