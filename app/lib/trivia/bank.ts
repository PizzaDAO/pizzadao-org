// app/lib/trivia/bank.ts
//
// Loads the question bank from the database (TriviaQuestion, via bank-store.ts), validates every row with QuestionSchema,
// and decides what may be served. plans/trivia.md §4.2. Only `approved` questions are ever served; `flagged`,
// `needs_snax` and `rejected` ones stay in the bank as a record (so they are not re-added) but are filtered out here.
//
// Cache: one in-process copy, refreshed at most every BANK_TTL_MS (60 s). An admin write in this instance calls
// invalidateBank(), so the editor sees its own change at once; other instances pick it up within the TTL.
// Unreachable database: the last good copy keeps being served; with none, the bank is empty and every caller no-ops
// (no Discord round opens, the web daily answers 503, nothing is paid), with a clear log line.
//
// Answer secrecy: everything a client sees before an attempt goes through publicView(); the answer, aliases, rejects,
// explanation and sources only leave the server through reveal(), after an attempt.
import { listBankRows, markRowsExposed, type BankRow } from "./bank-store";
import { QuestionSchema, type PublicQuestion, type QuestionReveal, type TriviaPool, type TriviaQuestion } from "./schema";

export const BANK_TTL_MS = 60_000;
/** After a failed read with nothing cached, try again this soon (not on every request). */
const FAILED_RETRY_MS = 10_000;

export interface LoadedBank {
  /** Valid questions, sorted by id. */
  questions: TriviaQuestion[];
  /** Ids whose text and answer are in public git history (TriviaQuestion.exposed). */
  exposedIds: ReadonlySet<string>;
  /** False when the database could not be read and nothing was cached. */
  available: boolean;
  /** Rows whose data failed the schema: never served (the editor shows them for repair). */
  invalid: { id: string; error: string }[];
}

const EMPTY: LoadedBank = { questions: [], exposedIds: new Set(), available: false, invalid: [] };

let cache: { bank: LoadedBank; expiresAt: number } | null = null;
let inflight: Promise<LoadedBank> | null = null;
let generation = 0;

/** Parse rows into a bank. Rows that fail the schema (or whose data id is not the row id) are dropped and logged. */
export function bankFromRows(rows: BankRow[]): LoadedBank {
  const questions: TriviaQuestion[] = [];
  const exposed = new Set<string>();
  const invalid: LoadedBank["invalid"] = [];
  for (const r of rows) {
    const parsed = QuestionSchema.safeParse(r.data);
    if (!parsed.success || parsed.data.id !== r.id) {
      const error = parsed.success ? `data id ${parsed.data.id} is not the row id` : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      invalid.push({ id: r.id, error });
      continue;
    }
    questions.push(parsed.data);
    if (r.exposed) exposed.add(r.id);
  }
  if (invalid.length) console.error(`[trivia] ${invalid.length} bank row(s) fail the schema and are not served: ${invalid.map((i) => i.id).join(", ")}`);
  questions.sort((a, b) => a.id.localeCompare(b.id));
  return { questions, exposedIds: exposed, available: true, invalid };
}

async function load(): Promise<{ bank: LoadedBank; ttl: number }> {
  try {
    const bank = bankFromRows(await listBankRows());
    if (bank.questions.length === 0) {
      console.warn("[trivia] the question bank is empty: import it with scripts/trivia/import-bank.ts. Discord rounds and the web daily are skipped until then.");
    }
    return { bank, ttl: BANK_TTL_MS };
  } catch (e) {
    const stale = cache?.bank;
    console.error(
      `[trivia] question bank unavailable (${(e as Error).message?.slice(0, 160)}): ${stale ? "serving the last good copy" : "no bank, so Discord rounds and the web daily are skipped"}`,
    );
    return stale ? { bank: stale, ttl: FAILED_RETRY_MS } : { bank: EMPTY, ttl: FAILED_RETRY_MS };
  }
}

/** The validated bank (cached). Never throws. */
export async function getBank(): Promise<LoadedBank> {
  if (cache && Date.now() < cache.expiresAt) return cache.bank;
  if (!inflight) {
    const gen = generation;
    const p = load().then(({ bank, ttl }) => {
      // A write in this instance while the read was in flight makes the read stale: do not cache it.
      if (gen === generation) cache = { bank, expiresAt: Date.now() + ttl };
      return bank;
    });
    inflight = p;
    p.finally(() => {
      if (inflight === p) inflight = null;
    });
  }
  return inflight;
}

/** Drop the cached bank (after an admin write in this instance), so the next read goes to the database. */
export function invalidateBank(): void {
  generation++;
  cache = null;
  inflight = null;
}

export const REVEALED_ACTOR = "system:revealed";

/**
 * A question's answer has gone public (a Discord round closed, a question was served as the web daily): mark it
 * exposed, so the daily and the Discord picker do not use it again while fresh ones are left (and practice may).
 * Already exposed rows are untouched. Never throws: a failure is logged and the caller carries on.
 */
export async function markRevealed(ids: Iterable<string>): Promise<void> {
  const list = [...new Set(ids)];
  if (list.length === 0) return;
  try {
    const bank = await getBank();
    if (list.every((id) => bank.exposedIds.has(id))) return; // nothing to do (cheap: no write)
    if ((await markRowsExposed(list, REVEALED_ACTOR)) > 0) invalidateBank();
  } catch (e) {
    console.error(`[trivia] could not mark ${list.join(", ")} exposed: ${(e as Error).message?.slice(0, 120)}`);
  }
}

/** Every id in use, valid rows and broken ones (a new id must not collide with either). */
export function bankIds(bank: LoadedBank): string[] {
  return [...bank.questions.map((q) => q.id), ...bank.invalid.map((i) => i.id)];
}

export async function getQuestion(id: string): Promise<TriviaQuestion | undefined> {
  return (await getBank()).questions.find((q) => q.id === id);
}

/** When a question with `validUntil` retires: the end of that day (UTC) for a plain date. */
export function validUntilMs(validUntil: string): number {
  const ms = Date.parse(validUntil);
  if (Number.isNaN(ms)) return 0; // unparseable: treat as already expired (never served)
  return /^\d{4}-\d{2}-\d{2}$/.test(validUntil) ? ms + 24 * 60 * 60 * 1000 : ms;
}

export interface ServableOptions {
  now?: Date;
  /** Instant pull: ids disabled in settings (`trivia.disabledQuestionIds`). */
  disabledIds?: Iterable<string>;
  /** Restrict to one pool. The web must pass "web"; the Discord rounds must pass "discord". */
  pool: TriviaPool;
}

/** Approved, unexpired, not disabled questions of one pool, from a given list. Pure. */
export function filterServable(questions: readonly TriviaQuestion[], { now = new Date(), disabledIds = [], pool }: ServableOptions): TriviaQuestion[] {
  const disabled = new Set(disabledIds);
  return questions.filter(
    (q) =>
      q.status === "approved" &&
      q.pool === pool &&
      !disabled.has(q.id) &&
      (!q.validUntil || now.getTime() < validUntilMs(q.validUntil)),
  );
}

/** Approved, unexpired, not disabled questions of one pool. Empty when the bank is empty or unreachable. */
export async function servable(opts: ServableOptions): Promise<TriviaQuestion[]> {
  return filterServable((await getBank()).questions, opts);
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
  /** False when the database could not be read. */
  available: boolean;
  total: number;
  byStatus: Record<string, number>;
  servableDiscord: number;
  servableWeb: number;
  /** Approved questions still exposed (in public git history): they want rewording. */
  exposedApproved: number;
  byCategory: Record<string, number>;
  byType: Record<string, number>;
  byDifficulty: Record<string, number>;
  /** Questions with a validUntil, soonest first. */
  expiring: { id: string; validUntil: string }[];
  /** Everything that is in the bank but not served. */
  notServed: { id: string; status: string; category: string }[];
  /** Rows that fail the schema (never served). */
  invalid: { id: string; error: string }[];
}

function tally<T>(items: T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) out[key(i)] = (out[key(i)] ?? 0) + 1;
  return out;
}

export async function bankStats(now: Date = new Date()): Promise<BankStats> {
  const bank = await getBank();
  const qs = bank.questions;
  const approved = qs.filter((q) => q.status === "approved");
  return {
    available: bank.available,
    total: qs.length,
    byStatus: tally(qs, (q) => q.status),
    servableDiscord: filterServable(qs, { now, pool: "discord" }).length,
    servableWeb: filterServable(qs, { now, pool: "web" }).length,
    exposedApproved: approved.filter((q) => bank.exposedIds.has(q.id)).length,
    byCategory: tally(approved, (q) => q.category),
    byType: tally(approved, (q) => q.type),
    byDifficulty: tally(approved, (q) => q.difficulty),
    expiring: qs
      .filter((q) => q.validUntil)
      .map((q) => ({ id: q.id, validUntil: q.validUntil! }))
      .sort((a, b) => a.validUntil.localeCompare(b.validUntil)),
    notServed: qs.filter((q) => q.status !== "approved").map((q) => ({ id: q.id, status: q.status, category: q.category })),
    invalid: bank.invalid,
  };
}
