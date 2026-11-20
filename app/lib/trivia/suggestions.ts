// app/lib/trivia/suggestions.ts
//
// Community question suggestions (plans/trivia.md section 10, phase 3), the database half. A suggestion is a TriviaReport
// row with kind = "suggestion": questionId is "" and payload holds the validated fields (suggestion-core.ts). Statuses:
// open (in the admin queue), added (an admin put it in the bank with "Add to bank": a flagged draft row), dismissed.
// Only addSuggestionToBank writes to the question bank; suggestions never touch the pulled-questions setting or the
// report counts: every report query filters kind = "report".
import { prisma } from "@/app/lib/db";
import { Prisma } from "@prisma/client";
import { bankIds, getBank } from "./bank";
import { createQuestion } from "./bank-admin";
import { listBankRows } from "./bank-store";
import { buildQuestionSnippet, snippetJson, SUGGESTIONS_PER_DAY, validateSuggestion, type SuggestionInput, type SuggestionPayload } from "./suggestion-core";

export type SuggestionStatus = "open" | "added" | "dismissed";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Lock namespace for one member's suggestions (first key of the two-key lock). */
export const SUGGESTION_LOCK_NAMESPACE = 742019346;

export type SuggestionOutcome = { status: "recorded"; id: number } | { status: "limit" };

/**
 * Store a validated suggestion for a member. At most SUGGESTIONS_PER_DAY per member per rolling 24 hours (every status
 * counts, so dismissing does not hand the member more): the count and the insert run under one advisory lock, so
 * parallel submits cannot slip past the cap.
 */
export async function recordSuggestion(discordId: string, value: SuggestionPayload, now: Date = new Date()): Promise<SuggestionOutcome> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SUGGESTION_LOCK_NAMESPACE}::int, hashtext(${discordId}))`;
    const recent = await tx.triviaReport.count({ where: { kind: "suggestion", discordId, createdAt: { gte: new Date(now.getTime() - DAY_MS) } } });
    if (recent >= SUGGESTIONS_PER_DAY) return { status: "limit" as const };
    const row = await tx.triviaReport.create({
      data: { kind: "suggestion", questionId: "", discordId, text: value.question.slice(0, 500), status: "open", payload: value as unknown as Prisma.InputJsonValue, createdAt: now },
      select: { id: true },
    });
    return { status: "recorded" as const, id: row.id };
  });
}

/** How many suggestions the member may still send in the next 24 hours (0 when unavailable). */
export async function suggestionsRemaining(discordId: string, now: Date = new Date()): Promise<number> {
  try {
    const used = await prisma.triviaReport.count({ where: { kind: "suggestion", discordId, createdAt: { gte: new Date(now.getTime() - DAY_MS) } } });
    return Math.max(0, SUGGESTIONS_PER_DAY - used);
  } catch {
    return 0;
  }
}

/** Validate raw input and store it: the one entry point for the Discord modal and the web form. */
export async function submitSuggestion(discordId: string, input: SuggestionInput, now: Date = new Date()): Promise<{ status: "invalid"; field: string } | SuggestionOutcome> {
  const v = validateSuggestion(input);
  if (!v.ok) return { status: "invalid", field: v.error };
  return recordSuggestion(discordId, v.value, now);
}

export interface SuggestionRow {
  id: number;
  createdAt: Date;
  /** Null when the payload cannot be read (should not happen: it is written validated). */
  suggestion: SuggestionPayload | null;
  /** The draft "Add to bank" would create (pretty JSON, with the next free id); null when the payload is unreadable. */
  snippet: string | null;
}

/** Open suggestions, oldest first (first come, first reviewed), each with a preview of its draft. */
export async function openSuggestions(limit = 100): Promise<SuggestionRow[]> {
  const rows = await prisma.triviaReport.findMany({ where: { kind: "suggestion", status: "open" }, orderBy: { id: "asc" }, take: limit, select: { id: true, createdAt: true, payload: true } });
  const ids = bankIds(await getBank());
  const out: SuggestionRow[] = [];
  for (const r of rows) {
    const p = r.payload as Partial<SuggestionPayload> | null;
    const v = p ? validateSuggestion({ question: p.question, answer: p.answer, aliases: p.aliases, source: p.source, category: p.category }) : null;
    if (!v?.ok) {
      out.push({ id: r.id, createdAt: r.createdAt, suggestion: null, snippet: null });
      continue;
    }
    // Several open suggestions in one category all want "the next free id": number the previews past the earlier ones
    // (the real id is picked again from the database when a draft is added).
    let snippet: string | null = null;
    try {
      snippet = snippetJson(v.value, ids, r.id);
      ids.push(JSON.parse(snippet).id as string);
    } catch {
      snippet = null;
    }
    out.push({ id: r.id, createdAt: r.createdAt, suggestion: v.value, snippet });
  }
  return out;
}

/** Close an open suggestion (added to the bank, or dismissed). Returns false when it was not open (or not a suggestion). */
export async function closeSuggestion(id: number, status: Exclude<SuggestionStatus, "open">): Promise<boolean> {
  return (await prisma.triviaReport.updateMany({ where: { id, kind: "suggestion", status: "open" }, data: { status } })).count > 0;
}

export type AddToBankResult =
  | { status: "added"; questionId: string; existed: boolean }
  | { status: "not_open" }
  | { status: "unreadable" }
  | { status: "failed"; error: string; errors?: string[] };

/**
 * "Add to bank": create the suggestion's draft as a bank row (status flagged, so it is not served until an admin edits
 * and approves it), then mark the suggestion added. The id is the next free one in its category, picked from the
 * database at that moment (a race for the same id retries with the next one). Idempotent: if a draft from this
 * suggestion already exists (an earlier click whose close failed), the suggestion is just closed.
 */
export async function addSuggestionToBank(suggestionId: number, actor: string): Promise<AddToBankResult> {
  const row = await prisma.triviaReport.findFirst({ where: { id: suggestionId, kind: "suggestion", status: "open" }, select: { id: true, payload: true } });
  if (!row) return { status: "not_open" };
  const p = row.payload as Partial<SuggestionPayload> | null;
  const v = p ? validateSuggestion({ question: p.question, answer: p.answer, aliases: p.aliases, source: p.source, category: p.category }) : null;
  if (!v?.ok) return { status: "unreadable" };
  const marker = `Community suggestion #${suggestionId}.`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const rows = await listBankRows();
    const prior = rows.find((r) => {
      const notes = (r.data as { notes?: unknown } | null)?.notes;
      return typeof notes === "string" && notes.startsWith(marker);
    });
    if (prior) {
      await closeSuggestion(suggestionId, "added");
      return { status: "added", questionId: prior.id, existed: true };
    }
    const draft = buildQuestionSnippet(v.value, rows.map((r) => r.id), suggestionId);
    const created = await createQuestion(draft, actor);
    if (created.ok) {
      await closeSuggestion(suggestionId, "added");
      return { status: "added", questionId: created.row.id, existed: false };
    }
    if (created.status !== 409) return { status: "failed", error: created.error, errors: created.errors };
  }
  return { status: "failed", error: "Could not find a free id: try again" };
}
