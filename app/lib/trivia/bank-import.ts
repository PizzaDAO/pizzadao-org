// app/lib/trivia/bank-import.ts
//
// Bulk import of questions into the TriviaQuestion table (scripts/trivia/import-bank.ts is the CLI). Dry run unless
// `apply`. Every entry is checked like an editor write (QuestionSchema + matcher lint); with any invalid or duplicate
// entry nothing is written, and the writes run in ONE transaction (all or nothing).
//
// Re-importing never undoes work done since: a row last written by anything other than the import itself (an admin
// edit, a "revealed" flag) is skipped as "edited in admin", and a row changed after `asOf` (the import file's time) is
// skipped as newer. `force` overwrites both. Output is ids, field paths and counts only, never question text or answers.
import { checkQuestion } from "./bank-lint";
import { applyImportOps, listBankRows, type BankRow, type ImportOp } from "./bank-store";
import { QuestionSchema, type TriviaQuestion } from "./schema";

/** The updatedBy of every import write. Any other value means the row was changed outside the import. */
export const IMPORT_ACTOR = "script:import-bank";

export interface ImportOptions {
  apply: boolean;
  /** Overwrite rows edited in the admin or changed after asOf too. */
  force: boolean;
  /** Mark every imported row exposed (its text and answer are in public git history). */
  exposed: boolean;
  /** When the import's content was written: rows updated after this are newer than the import. */
  asOf: Date;
}

export interface ImportReport {
  total: number;
  /** Field paths only (never values). */
  invalid: { index: number; id: string | null; errors: string[] }[];
  duplicates: string[];
  create: string[];
  update: string[];
  unchanged: string[];
  /** Last written outside the import (admin edit, revealed flag): kept unless --force. */
  editedInAdmin: string[];
  /** Changed after asOf: kept unless --force. */
  newer: string[];
  /** Whether the writes were committed. */
  applied: boolean;
  /** The id whose write lost a race (the row appeared or changed meanwhile): the whole import was rolled back. */
  conflicts: string[];
}

export interface ImportStore {
  listBankRows: typeof listBankRows;
  applyImportOps: typeof applyImportOps;
}

const defaultStore: ImportStore = { listBankRows, applyImportOps };

/** The entries of an import file: a bank file ({ questions: [...] }) or a bare array. */
export function importEntries(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object" && Array.isArray((raw as { questions?: unknown }).questions)) return (raw as { questions: unknown[] }).questions;
  return null;
}

/** Key-order-independent JSON, to tell an unchanged question from a changed one. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as Record<string, unknown>)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

function sameQuestion(row: BankRow, q: TriviaQuestion): boolean {
  const parsed = QuestionSchema.safeParse(row.data);
  return parsed.success && canonical(parsed.data) === canonical(q);
}

/** A printable id: only something shaped like a question id, never arbitrary text from the file. */
function safeId(e: unknown): string | null {
  const id = e && typeof e === "object" ? (e as { id?: unknown }).id : null;
  return typeof id === "string" && /^[a-z]{2,4}-\d{3}$/.test(id) ? id : null;
}

export async function runImport(entries: unknown[], opts: ImportOptions, store: ImportStore = defaultStore): Promise<ImportReport> {
  const report: ImportReport = { total: entries.length, invalid: [], duplicates: [], create: [], update: [], unchanged: [], editedInAdmin: [], newer: [], applied: false, conflicts: [] };
  const valid: TriviaQuestion[] = [];
  const seen = new Set<string>();
  entries.forEach((e, index) => {
    const check = checkQuestion(e);
    if (!check.ok) {
      report.invalid.push({ index, id: safeId(e), errors: check.errors });
      return;
    }
    if (seen.has(check.question.id)) {
      report.duplicates.push(check.question.id);
      return;
    }
    seen.add(check.question.id);
    valid.push(check.question);
  });

  const existing = new Map((await store.listBankRows()).map((r) => [r.id, r]));
  const ops: ImportOp[] = [];
  for (const q of valid) {
    const row = existing.get(q.id);
    if (!row) {
      report.create.push(q.id);
      ops.push({ kind: "create", q, exposed: opts.exposed });
    } else if (sameQuestion(row, q) && (!opts.exposed || row.exposed)) {
      report.unchanged.push(q.id);
    } else if (!opts.force && row.updatedBy !== IMPORT_ACTOR) {
      report.editedInAdmin.push(q.id);
    } else if (!opts.force && row.updatedAt.getTime() > opts.asOf.getTime()) {
      report.newer.push(q.id);
    } else {
      report.update.push(q.id);
      // The update is guarded by the updatedAt read here: a row changed meanwhile rolls the import back.
      ops.push({ kind: "update", q, exposed: opts.exposed || row.exposed, expectUpdatedAt: row.updatedAt });
    }
  }

  if (!opts.apply || report.invalid.length > 0 || report.duplicates.length > 0 || ops.length === 0) {
    report.applied = opts.apply && report.invalid.length === 0 && report.duplicates.length === 0;
    return report;
  }
  const res = await store.applyImportOps(ops, IMPORT_ACTOR);
  if (res.ok) report.applied = true;
  else report.conflicts.push(res.conflict);
  return report;
}

/**
 * An error as one safe line: its name, Prisma code and the first line of its message, cut short. Prisma validation
 * errors print the whole query (the question data) after the first line; that part is never shown.
 */
export function describeError(e: unknown): string {
  const err = e as { name?: string; code?: string; message?: string } | null;
  const first = String(err?.message ?? "").split("\n").find((l) => l.trim()) ?? "";
  return [err?.name ?? "Error", err?.code, first.trim().slice(0, 120)].filter(Boolean).join(": ");
}

/** A short printable summary: ids, field paths and counts only. */
export function formatImportReport(r: ImportReport, opts: Pick<ImportOptions, "apply" | "force" | "exposed" | "asOf">): string {
  const done = opts.apply && r.applied;
  const lines = [
    `${opts.apply ? (r.applied ? "APPLIED" : "NOT APPLIED") : "DRY RUN (add --apply to write)"}  as of ${opts.asOf.toISOString()}${opts.force ? "  --force" : ""}${opts.exposed ? "  --exposed" : ""}`,
    `entries: ${r.total}  valid: ${r.total - r.invalid.length - r.duplicates.length}  invalid: ${r.invalid.length}  duplicate ids: ${r.duplicates.length}`,
    `${done ? "created" : "to create"}: ${r.create.length}  ${done ? "updated" : "to update"}: ${r.update.length}  unchanged: ${r.unchanged.length}  skipped (edited in admin): ${r.editedInAdmin.length}  skipped (newer in the database): ${r.newer.length}`,
  ];
  for (const i of r.invalid) lines.push(`  invalid #${i.index}${i.id ? ` (${i.id})` : ""}: ${i.errors.join("; ")}`);
  if (r.duplicates.length) lines.push(`  duplicate ids: ${r.duplicates.join(", ")}`);
  if (r.editedInAdmin.length) lines.push(`  skipped: edited in admin (use --force to overwrite): ${r.editedInAdmin.join(", ")}`);
  if (r.newer.length) lines.push(`  skipped: newer in the database (use --force to overwrite): ${r.newer.join(", ")}`);
  if (r.conflicts.length) lines.push(`  conflict on ${r.conflicts.join(", ")} (changed meanwhile): the whole import was rolled back, nothing was written. Run it again.`);
  if (opts.apply && !r.applied && !r.conflicts.length) lines.push("Nothing was written: fix the invalid or duplicate entries first.");
  return lines.join("\n");
}
