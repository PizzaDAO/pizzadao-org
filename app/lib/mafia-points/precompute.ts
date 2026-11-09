// Nightly precompute of every member's Pizza Mafia rank (cron /api/cron/mafia-ranks).
// Members are processed oldest-computed first (never-computed first), so a run that hits its
// time budget resumes where it stopped on the next night.

import { prisma } from "@/app/lib/db";
import { loadSettings } from "@/app/lib/settings";
import { effectiveInt } from "@/app/lib/settings/numbers";
import {
  getMembersTable,
  memberIdColumn,
  cellText,
  rowToRecord,
} from "@/app/lib/sheets/member-repository";
import { findWallet, refreshMafiaRank } from "./index";

export interface PrecomputeResult {
  total: number;
  computed: number;
  failed: number;
  remaining: number;
  stoppedEarly: boolean;
}

/** Member ids with a Discord id and/or a wallet (the only inputs a rank is computed from). */
export async function listRankableMemberIds(): Promise<string[]> {
  const table = await getMembersTable({ fresh: true });
  const idCol = memberIdColumn(table);
  const ids: string[] = [];
  for (const row of table.rows) {
    const id = cellText(row?.c?.[idCol]);
    if (!id) continue;
    const rec = rowToRecord(table, row);
    const discordId = String(rec["discordId"] || rec["DiscordID"] || rec["Discord ID"] || "").trim();
    if (discordId || findWallet(rec)) ids.push(id);
  }
  return [...new Set(ids)];
}

/** Never-computed first, then oldest computedAt; ties by member id for a stable order. */
export function orderOldestFirst(ids: string[], computedAt: Map<string, number>): string[] {
  return [...ids].sort((a, b) => {
    const ta = computedAt.get(a) ?? 0;
    const tb = computedAt.get(b) ?? 0;
    return ta - tb || a.localeCompare(b, undefined, { numeric: true });
  });
}

export async function runMafiaRankPrecompute(opts: {
  budgetMs: number;
  concurrency?: number;
  now?: () => number;
  refresh?: (memberId: string) => Promise<unknown>;
}): Promise<PrecomputeResult> {
  const now = opts.now ?? Date.now;
  const refresh = opts.refresh ?? refreshMafiaRank;
  const deadline = now() + opts.budgetMs;
  const settings = await loadSettings();
  const concurrency = Math.max(
    1,
    opts.concurrency ?? effectiveInt("mafia.rankPrecomputeConcurrency", settings),
  );

  const ids = await listRankableMemberIds();
  const rows: Array<{ memberId: string; computedAt: Date }> = await prisma.mafiaRankCache.findMany({
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
