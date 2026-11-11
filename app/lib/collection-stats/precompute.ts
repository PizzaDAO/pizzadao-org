// Nightly precompute of every member's collection counts (cron /api/cron/collection-stats).
// Same shape as the mafia rank job: oldest-computed first, a time budget, resumes next night.

import { prisma } from "@/app/lib/db";
import { listRankableMemberIds, orderOldestFirst } from "@/app/lib/mafia-points/precompute";
import { refreshCollectionStats } from "./index";

export interface CollectionStatsPrecomputeResult {
  total: number;
  computed: number;
  failed: number;
  remaining: number;
  stoppedEarly: boolean;
}

export async function runCollectionStatsPrecompute(opts: {
  budgetMs: number;
  concurrency?: number;
  now?: () => number;
  refresh?: (memberId: string) => Promise<unknown>;
  listIds?: () => Promise<string[]>;
}): Promise<CollectionStatsPrecomputeResult> {
  const now = opts.now ?? Date.now;
  const refresh = opts.refresh ?? refreshCollectionStats;
  const deadline = now() + opts.budgetMs;
  const concurrency = Math.max(1, opts.concurrency ?? 4);

  const ids = await (opts.listIds ?? listRankableMemberIds)();
  const rows: Array<{ memberId: string; computedAt: Date }> = await prisma.memberCollectionStats.findMany({
    select: { memberId: true, computedAt: true },
  });
  const computedAt = new Map(rows.map((r) => [r.memberId, r.computedAt.getTime()] as const));
  const queue = orderOldestFirst(ids, computedAt);

  let next = 0;
  let computed = 0;
  let failed = 0;
  const worker = async () => {
    while (next < queue.length && now() < deadline) {
      const id = queue[next++];
      try {
        await refresh(id);
        computed++;
      } catch {
        failed++;
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  const remaining = queue.length - next;
  return { total: queue.length, computed, failed, remaining, stoppedEarly: remaining > 0 };
}
