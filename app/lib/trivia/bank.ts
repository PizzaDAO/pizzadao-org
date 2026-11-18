// app/lib/trivia/bank.ts
//
// Loads and validates the question bank once (build-time JSON import, zod-checked) and decides what may be served.
// plans/trivia.md §4.2. Only `approved` questions are ever served; `flagged`, `needs_snax` and `rejected` ones stay in
// the file as a record (so they are not re-added) but are filtered out here.
//
// Answer secrecy: everything a client sees before an attempt goes through publicView(); the answer, aliases, rejects,
// explanation and sources only leave the server through reveal(), after an attempt.
import raw from "@/data/trivia/questions.json";
import { BankSchema, type PublicQuestion, type QuestionReveal, type TriviaBank, type TriviaPool, type TriviaQuestion } from "./schema";

let cached: TriviaBank | null = null;

/** The validated bank. Throws (loudly, once) if the JSON on disk is malformed. */
export function getBank(): TriviaBank {
  if (!cached) cached = BankSchema.parse(raw);
  return cached;
}

export function getQuestion(id: string): TriviaQuestion | undefined {
  return getBank().questions.find((q) => q.id === id);
}

/** When a question with `validUntil` retires: the end of that day (UTC) for a plain date. */
export function validUntilMs(validUntil: string): number {
  const ms = Date.parse(validUntil);
  if (Number.isNaN(ms)) return 0; // unparseable: treat as already expired (never served)
  return /^\d{4}-\d{2}-\d{2}$/.test(validUntil) ? ms + 24 * 60 * 60 * 1000 : ms;
}

export interface ServableOptions {
  now?: Date;
  /** Instant pull: ids disabled in settings (phase 2 wires `trivia.disabledQuestionIds`; empty today). */
  disabledIds?: Iterable<string>;
  /** Restrict to one pool. The web must pass "web"; the Discord rounds (phase 2) must pass "discord". */
  pool: TriviaPool;
}

/** Approved, unexpired, not disabled questions of one pool. */
export function servable({ now = new Date(), disabledIds = [], pool }: ServableOptions): TriviaQuestion[] {
  const disabled = new Set(disabledIds);
  return getBank().questions.filter(
    (q) =>
      q.status === "approved" &&
      q.pool === pool &&
      !disabled.has(q.id) &&
      (!q.validUntil || now.getTime() < validUntilMs(q.validUntil)),
  );
}

/** Strips everything that reveals the answer (answer, aliases, rejects, match, explanation, sources, notes). */
export function publicView(q: TriviaQuestion): PublicQuestion {
  const view: PublicQuestion = {
    id: q.id,
    category: q.category,
    type: q.type,
    difficulty: q.difficulty,
    question: q.question,
  };
  if (q.choices) view.choices = [...q.choices];
  if (q.label) view.label = q.label;
  return view;
}

/** What may be shown once an attempt has been made. Never includes aliases, rejects or notes. */
export function reveal(q: TriviaQuestion): QuestionReveal {
  return {
    answer: q.match.kind === "boolean" ? (q.answer === "true" ? "True" : "False") : q.answer,
    explanation: q.explanation,
    sources: q.sources.map((s) => ({ url: s.url, note: s.note })),
  };
}

export interface BankStats {
  total: number;
  byStatus: Record<string, number>;
  servableDiscord: number;
  servableWeb: number;
  byCategory: Record<string, number>;
  byType: Record<string, number>;
  byDifficulty: Record<string, number>;
  /** Questions with a validUntil, soonest first. */
  expiring: { id: string; validUntil: string }[];
  /** Everything that is in the file but not served. */
  notServed: { id: string; status: string; category: string }[];
}

function tally<T>(items: T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) out[key(i)] = (out[key(i)] ?? 0) + 1;
  return out;
}

export function bankStats(now: Date = new Date()): BankStats {
  const qs = getBank().questions;
  return {
    total: qs.length,
    byStatus: tally(qs, (q) => q.status),
    servableDiscord: servable({ now, pool: "discord" }).length,
    servableWeb: servable({ now, pool: "web" }).length,
    byCategory: tally(qs.filter((q) => q.status === "approved"), (q) => q.category),
    byType: tally(qs.filter((q) => q.status === "approved"), (q) => q.type),
    byDifficulty: tally(qs.filter((q) => q.status === "approved"), (q) => q.difficulty),
    expiring: qs
      .filter((q) => q.validUntil)
      .map((q) => ({ id: q.id, validUntil: q.validUntil! }))
      .sort((a, b) => a.validUntil.localeCompare(b.validUntil)),
    notServed: qs.filter((q) => q.status !== "approved").map((q) => ({ id: q.id, status: q.status, category: q.category })),
  };
}
