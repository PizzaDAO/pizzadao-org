// app/lib/newsletter/sources/calls.ts
//
// "Call updates": what the crews did since the last issue, from published call recordings and crew
// tasks. Goes through the same privacy rules as the public Discord recap: excluded crews and blocked
// terms are dropped, imported calls only when allowed, calls whose redactions are newer than their
// summary are skipped, mentions are neutralised. Transcripts are never read here.
import { prisma } from "@/app/lib/db";
import {
  neutralizeMentions,
  recapBullets,
  recapCrewExcluded,
  recapUrl,
  redactionsNewerThanSummary,
  type RecapLimits,
} from "@/app/lib/calls/recap";
import { mentionsBlockedTerm, type PostFilter } from "@/app/lib/calls/post-filters";
import { DISCORD_ONLY, importedAllowed, isImportedSource } from "@/app/lib/calls/imported";
import { parseAllActionItems, taskChangesSince } from "@/app/lib/call-updates/sources";
import type { CallCrew } from "../sections";

export interface CallRow {
  id: string;
  source?: string | null;
  crewId: string | null;
  crewLabel: string | null;
  eventName?: string | null;
  summary: string | null;
  actionItems: unknown;
  chapters: unknown;
  publishedAt: Date | null;
  redactionsUpdatedAt?: Date | null;
  summaryGeneratedAt?: Date | null;
  summaryEditedAt?: Date | null;
}

export interface CallSelectOptions {
  filter: PostFilter;
  importedOk: boolean;
  ownerNames: boolean;
  maxCrews: number;
  limits: RecapLimits;
  base?: string;
}

/** Discord markup, mention syntax and control characters out of one line of text. */
export function plainLine(s: string): string {
  return neutralizeMentions(s)
    .replace(/<a?:\w+:\d+>/g, "")
    .replace(/<[#@][!&]?\d+>/g, "")
    .replace(/[*_~`|>]+/g, "")
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Why a call is not used, or null when it may be. */
export function skipReason(row: CallRow, opts: Pick<CallSelectOptions, "filter" | "importedOk">): string | null {
  if (recapCrewExcluded(row, opts.filter)) return "excluded";
  // A crew label derived from the event name goes through the same exclusion and term checks.
  if (!row.crewLabel && row.eventName && (recapCrewExcluded({ crewId: row.crewId, crewLabel: row.eventName }, opts.filter) || mentionsBlockedTerm(row.eventName, opts.filter))) return "excluded";
  if (row.crewLabel && mentionsBlockedTerm(row.crewLabel, opts.filter)) return "excluded";
  if (isImportedSource(row.source) && !opts.importedOk) return "imported";
  if (redactionsNewerThanSummary(row)) return "stale-redactions";
  return null;
}

/** Done action items of one call, filtered; the owner is kept only when names are allowed. */
export function shippedItems(raw: unknown, filter: PostFilter, ownerNames: boolean): string[] {
  const out: string[] = [];
  for (const it of parseAllActionItems(raw)) {
    if (it.done !== true) continue;
    const owner = ownerNames && it.owner ? plainLine(it.owner) : "";
    const body = plainLine(it.text);
    if (!body || mentionsBlockedTerm(body, filter) || mentionsBlockedTerm(owner, filter)) continue;
    out.push(owner ? `${body} (${owner})` : body);
  }
  return out;
}

/** Pure selection: group the usable calls by crew and build the per-crew bullets and shipped items. */
export function selectCallUpdates(rows: CallRow[], o: CallSelectOptions): { crews: CallCrew[]; callIds: string[] } {
  const groups = new Map<string, { label: string; rows: CallRow[]; bullets: string[]; shipped: string[] }>();
  for (const row of [...rows].sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0))) {
    if (skipReason(row, o)) continue;
    const key = row.crewId || row.crewLabel || "other";
    const g = groups.get(key) ?? { label: plainLine(row.crewLabel || row.eventName || "Community"), rows: [], bullets: [], shipped: [] };
    const bullets = recapBullets(row.summary, row.chapters, o.filter, o.limits).map(plainLine).filter((b) => b && !mentionsBlockedTerm(b, o.filter));
    const shipped = shippedItems(row.actionItems, o.filter, o.ownerNames);
    if (!bullets.length && !shipped.length) continue;
    g.rows.push(row);
    g.bullets.push(...bullets);
    g.shipped.push(...shipped);
    groups.set(key, g);
  }
  const crews = [...groups.entries()]
    .sort((a, b) => b[1].rows.length - a[1].rows.length)
    .slice(0, o.maxCrews)
    .map(([id, g]): CallCrew => ({
      id,
      label: g.label,
      summary: g.bullets.slice(0, 3).join(" "),
      bullets: g.bullets.slice(0, o.limits.bullets),
      shipped: [...new Set(g.shipped)].slice(0, o.limits.actions),
      url: recapUrl(g.rows[0]!.id, o.base),
      included: true,
    }));
  const kept = new Set(crews.map((c) => c.id));
  const callIds = [...groups.entries()].filter(([id]) => kept.has(id)).flatMap(([, g]) => g.rows.map((r) => r.id));
  return { crews, callIds };
}

/** Task labels completed since `since`, filtered like the rest (labels only, never owners). */
export function filterTaskLabels(labels: string[], filter: PostFilter): string[] {
  return labels.map(plainLine).filter((l) => l && !mentionsBlockedTerm(l, filter));
}

export async function gatherCallUpdates(
  period: { start: Date; end: Date },
  o: Omit<CallSelectOptions, "importedOk">,
): Promise<{ crews: CallCrew[]; callIds: string[] }> {
  const importedOk = await importedAllowed("calls.importedRecapPostEnabled");
  const rows = await prisma.callRecording.findMany({
    where: { status: "PUBLISHED", publishedAt: { gt: period.start, lte: period.end }, ...(importedOk ? {} : DISCORD_ONLY) },
    orderBy: { publishedAt: "desc" },
    take: 200,
    select: {
      id: true,
      source: true,
      crewId: true,
      crewLabel: true,
      eventName: true,
      summary: true,
      actionItems: true,
      chapters: true,
      publishedAt: true,
      redactionsUpdatedAt: true,
      summaryGeneratedAt: true,
      summaryEditedAt: true,
    },
  });
  const sel = selectCallUpdates(rows, { ...o, importedOk });
  for (const crew of sel.crews) {
    if (crew.id === "other" || !rows.some((r) => r.crewId === crew.id)) continue;
    try {
      const changes = await taskChangesSince(crew.id, period.start);
      crew.shipped = [...new Set([...crew.shipped, ...filterTaskLabels(changes.done, o.filter)])].slice(0, o.limits.actions + 10);
    } catch {
      // Task changes are a bonus; the call text stands without them.
    }
  }
  return sel;
}
