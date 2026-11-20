// app/lib/trivia/bank-import.ts
//
// Bulk import of questions into the TriviaQuestion table (scripts/trivia/import-bank.ts is the CLI). Dry run unless
// `apply`. Every entry is checked like an editor write (QuestionSchema + matcher lint); with any invalid or duplicate
// entry nothing is written. A row changed after `asOf` (the import file's time, normally) is never overwritten unless
// `force`, so re-running an old file cannot undo edits made in /admin/trivia since. Prints ids and counts only, never
// question text or answers.
import { checkQuestion } from "./bank-lint";
import { insertBankRow, listBankRows, updateBankRow, type BankRow } from "./bank-store";
import { QuestionSchema, type TriviaQuestion } from "./schema";

export interface ImportOptions {
  apply: boolean;
  /** Overwrite rows changed after asOf too. */
  force: boolean;
  /** Mark every imported row exposed (its text and answer are in public git history). */
  exposed: boolean;
  /** When the import's content was written: rows updated after this are newer than the import. */
  asOf: Date;
  /** Recorded in updatedBy. */
  actor: string;
}

export interface ImportReport {
  total: number;
  invalid: { index: number; id: string | null; errors: string[] }[];
  duplicates: string[];
  create: string[];
  update: string[];
  unchanged: string[];
  /** Rows changed after asOf, left alone (no --force). */
  newer: string[];
  /** Whether anything was written (apply, and every entry valid). */
  applied: boolean;
  /** Ids whose write lost a race (the row appeared or changed meanwhile): not written. */
  conflicts: string[];
}

export interface ImportStore {
  listBankRows: typeof listBankRows;
  insertBankRow: typeof insertBankRow;
  updateBankRow: typeof updateBankRow;
}

const defaultStore: ImportStore = { listBankRows, insertBankRow, updateBankRow };

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

export async function runImport(entries: unknown[], opts: ImportOptions, store: ImportStore = defaultStore): Promise<ImportReport> {
  const report: ImportReport = { total: entries.length, invalid: [], duplicates: [], create: [], update: [], unchanged: [], newer: [], applied: false, conflicts: [] };
  const valid: TriviaQuestion[] = [];
  const seen = new Set<string>();
  entries.forEach((e, index) => {
    const id = e && typeof e === "object" && typeof (e as { id?: unknown }).id === "string" ? (e as { id: string }).id : null;
    const check = checkQuestion(e);
    if (!check.ok) {
      report.invalid.push({ index, id, errors: check.errors });
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
  const plan: { q: TriviaQuestion; row: BankRow | undefined }[] = [];
  for (const q of valid) {
    const row = existing.get(q.id);
    if (!row) {
      report.create.push(q.id);
      plan.push({ q, row });
    } else if (sameQuestion(row, q) && (!opts.exposed || row.exposed)) {
      report.unchanged.push(q.id);
    } else if (!opts.force && row.updatedAt.getTime() > opts.asOf.getTime()) {
      report.newer.push(q.id);
    } else {
      report.update.push(q.id);
      plan.push({ q, row });
    }
  }

  if (!opts.apply || report.invalid.length > 0 || report.duplicates.length > 0) return report;

  for (const { q, row } of plan) {
    if (!row) {
      const created = await store.insertBankRow(q, { exposed: opts.exposed, actor: opts.actor });
      if (!created) report.conflicts.push(q.id);
    } else {
      const updated = await store.updateBankRow(q, { exposed: opts.exposed || row.exposed, actor: opts.actor, notNewerThan: opts.force ? undefined : opts.asOf });
      if (!updated) report.conflicts.push(q.id);
    }
  }
  report.applied = true;
  return report;
}

/** A short printable summary (ids and counts only). */
export function formatImportReport(r: ImportReport, opts: Pick<ImportOptions, "apply" | "force" | "exposed" | "asOf">): string {
  const lines = [
    `${opts.apply ? (r.applied ? "APPLIED" : "NOT APPLIED") : "DRY RUN (add --apply to write)"}  as of ${opts.asOf.toISOString()}${opts.force ? "  --force" : ""}${opts.exposed ? "  --exposed" : ""}`,
    `entries: ${r.total}  valid: ${r.total - r.invalid.length - r.duplicates.length}  invalid: ${r.invalid.length}  duplicate ids: ${r.duplicates.length}`,
    `${opts.apply && r.applied ? "created" : "to create"}: ${r.create.length}  ${opts.apply && r.applied ? "updated" : "to update"}: ${r.update.length}  unchanged: ${r.unchanged.length}  newer in the database (kept): ${r.newer.length}`,
  ];
  if (r.conflicts.length) lines.push(`conflicts (changed meanwhile, not written): ${r.conflicts.join(", ")}`);
  for (const i of r.invalid) lines.push(`  invalid #${i.index}${i.id ? ` (${i.id})` : ""}: ${i.errors.join("; ")}`);
  if (r.duplicates.length) lines.push(`  duplicate ids: ${r.duplicates.join(", ")}`);
  if (r.newer.length) lines.push(`  newer (use --force to overwrite): ${r.newer.join(", ")}`);
  if (opts.apply && !r.applied) lines.push("Nothing was written: fix the invalid or duplicate entries first.");
  return lines.join("\n");
}
