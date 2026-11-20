// app/lib/trivia/bank-admin.ts
//
// Writes to the question bank from /admin/trivia (the API route checks the caller is an admin first). Every write is
// validated with QuestionSchema plus the matcher lint (bank-lint.ts), records the actor in updatedBy, and drops this
// instance's bank cache so the change is served at once (other instances within BANK_TTL_MS).
//
// Exposed questions (see exposed.ts): the id is public and history maps id -> answer, so rewording the question text
// does NOT clear `exposed`. Only a new answer clears it: one that is not the old answer, not an old alias, and not
// something the old matcher would accept. The editor can also set the flag explicitly.
//
// Every update is guarded by the updatedAt of the row it read (or the one the editor loaded): a row changed in between
// is never overwritten (409). The answer of the question in the open Discord round cannot change mid-round (409).
import { prisma } from "@/app/lib/db";
import { bankFromRows, bankIds, invalidateBank } from "./bank";
import { checkQuestion } from "./bank-lint";
import { getBankRow, insertBankRow, listBankRows, updateBankRow, type BankRow } from "./bank-store";
import { match, normalizeText } from "./match";
import { POOLS, QuestionSchema, STATUSES, type TriviaPool, type TriviaQuestion } from "./schema";

export type BankWriteResult = { ok: true; row: AdminQuestionRow } | { ok: false; status: 400 | 404 | 409; error: string; errors?: string[] };

/** One bank row as the editor sees it: the parsed question, or the raw data and why it does not parse. */
export interface AdminQuestionRow {
  id: string;
  status: string;
  pool: string | null;
  category: string;
  exposed: boolean;
  updatedAt: string;
  updatedBy: string | null;
  question: TriviaQuestion | null;
  /** The stored object as is (for the raw JSON editor). */
  data: unknown;
  error: string | null;
}

export function toAdminRow(r: BankRow): AdminQuestionRow {
  const parsed = QuestionSchema.safeParse(r.data);
  const ok = parsed.success && parsed.data.id === r.id;
  return {
    id: r.id,
    status: r.status,
    pool: r.pool,
    category: r.category,
    exposed: r.exposed,
    updatedAt: r.updatedAt.toISOString(),
    updatedBy: r.updatedBy,
    question: ok ? parsed.data : null,
    data: r.data,
    error: ok ? null : parsed.success ? `data id ${parsed.data.id} is not the row id` : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
  };
}

export interface AdminFilter {
  status?: string;
  pool?: string;
  category?: string;
  exposed?: boolean;
}

/** Every bank row (fresh from the database, not the cache), filtered, sorted by id. */
export async function listAdminQuestions(filter: AdminFilter = {}): Promise<AdminQuestionRow[]> {
  const rows = await listBankRows();
  return rows
    .filter((r) => (!filter.status || r.status === filter.status) && (!filter.pool || (filter.pool === "none" ? r.pool === null : r.pool === filter.pool)))
    .filter((r) => (!filter.category || r.category === filter.category) && (filter.exposed === undefined || r.exposed === filter.exposed))
    .map(toAdminRow);
}

/** All ids in the bank right now (fresh read), for picking a new one. */
export async function currentBankIds(): Promise<string[]> {
  return bankIds(bankFromRows(await listBankRows()));
}

function invalid(errors: string[]): BankWriteResult {
  return { ok: false, status: 400, error: "The question is not valid", errors };
}

function parseExpected(v: string | undefined): Date | undefined | null {
  if (v === undefined) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Create a question. Exposed is false: a question first written in the editor has never been in git. */
export async function createQuestion(value: unknown, actor: string): Promise<BankWriteResult> {
  const check = checkQuestion(value);
  if (!check.ok) return invalid(check.errors);
  const row = await insertBankRow(check.question, { exposed: false, actor });
  if (!row) return { ok: false, status: 409, error: `The id ${check.question.id} is already taken` };
  invalidateBank();
  return { ok: true, row: toAdminRow(row) };
}

export interface UpdateOptions {
  /** The updatedAt the editor loaded: refused (409) when the row changed since. */
  expectUpdatedAt?: string;
  /** Set the exposed flag explicitly. Absent: kept, or cleared when the answer changed to a genuinely new one. */
  exposed?: boolean;
}

/** Replace a question (same id). */
export async function updateQuestion(id: string, value: unknown, actor: string, opts: UpdateOptions = {}): Promise<BankWriteResult> {
  const expected = parseExpected(opts.expectUpdatedAt);
  if (expected === null) return { ok: false, status: 400, error: "Bad expectUpdatedAt" };
  const existing = await getBankRow(id);
  if (!existing) return { ok: false, status: 404, error: "Unknown question" };
  const check = checkQuestion(value);
  if (!check.ok) return invalid(check.errors);
  const q = check.question;
  if (q.id !== id) return invalid([`id: the id cannot change (${id})`]);
  const old = QuestionSchema.safeParse(existing.data);
  if (old.success && gradingChanged(old.data, q) && (await isOpenDiscordQuestion(id))) {
    return { ok: false, status: 409, error: "This question is in the open Discord round: its answer, aliases, rejects and matcher cannot change until the round closes" };
  }
  const exposed = opts.exposed ?? (old.success && newAnswer(old.data, q.answer) ? false : existing.exposed);
  // Default guard: the row just read. A write in between (another admin, the import, a reveal) is never overwritten.
  const row = await updateBankRow(q, { exposed, actor, expectUpdatedAt: expected ?? existing.updatedAt });
  invalidateBank();
  if (!row) return { ok: false, status: 409, error: "The question changed since you opened it: reload and try again" };
  return { ok: true, row: toAdminRow(row) };
}

export interface StatusChange {
  status: string;
  /** Required to approve a question that has no pool yet; ignored for other statuses (only approved questions have one). */
  pool?: string;
  /** For a retired (rejected) question: why, and who decided. */
  rejectedReason?: string;
  expectUpdatedAt?: string;
}

/** Approve / flag / retire a question, or move an approved one to the other pool. The text and answer are untouched. */
export async function setQuestionStatus(id: string, change: StatusChange, actor: string): Promise<BankWriteResult> {
  if (!(STATUSES as readonly string[]).includes(change.status)) return invalid([`status: one of ${STATUSES.join(", ")}`]);
  if (change.pool !== undefined && !(POOLS as readonly string[]).includes(change.pool)) return invalid([`pool: one of ${POOLS.join(", ")}`]);
  const existing = await getBankRow(id);
  if (!existing) return { ok: false, status: 404, error: "Unknown question" };
  const old = QuestionSchema.safeParse(existing.data);
  if (!old.success) return invalid(["The stored question does not parse: fix it in the JSON editor first"]);
  const next: TriviaQuestion = { ...old.data, status: change.status as TriviaQuestion["status"] };
  if (next.status === "approved") next.pool = (change.pool as TriviaPool | undefined) ?? old.data.pool;
  else delete next.pool;
  if (next.status === "rejected") {
    if (change.rejectedReason?.trim()) next.rejectedReason = change.rejectedReason.trim();
  } else delete next.rejectedReason;
  return updateQuestion(id, next, actor, { expectUpdatedAt: change.expectUpdatedAt ?? existing.updatedAt.toISOString() });
}

/** Whether a changed answer is genuinely new: not the old answer, not an old alias, not accepted by the old matcher. */
export function newAnswer(old: TriviaQuestion, answer: string): boolean {
  const n = normalizeText(answer);
  if ([old.answer, ...old.aliases].some((a) => normalizeText(a) === n)) return false;
  return match(old, answer).verdict !== "correct";
}

/** Whether an edit changes how answers are graded. */
function gradingChanged(a: TriviaQuestion, b: TriviaQuestion): boolean {
  const g = (q: TriviaQuestion) => JSON.stringify([q.answer, q.aliases, q.rejects, q.match, q.choices ?? null, q.type]);
  return g(a) !== g(b);
}

/** Whether `id` is the question of an OPEN Discord round right now. */
async function isOpenDiscordQuestion(id: string): Promise<boolean> {
  const open = await prisma.triviaRound.findFirst({ where: { surface: "DISCORD", status: "OPEN", questionId: id }, select: { id: true } });
  return !!open;
}
