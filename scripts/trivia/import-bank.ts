/**
 * Import trivia questions into the TriviaQuestion table (the bank is no longer in the repo: it is public).
 *
 *   DATABASE_URL=... npx tsx scripts/trivia/import-bank.ts <questions.json>
 *       dry run (default): validates every entry and prints what it would create / update / keep. Writes nothing.
 *   ... --apply
 *       upserts, all in one transaction. Refuses to write anything if any entry is invalid (QuestionSchema + matcher
 *       lint) or an id repeats; a row that changed meanwhile rolls the whole import back.
 *   ... --exposed
 *       marks every imported row exposed=true (its text and answer are in public git history: the original bank).
 *   ... --force
 *       also overwrites rows edited outside the import (updatedBy is not script:import-bank: an admin edit, a reveal)
 *       and rows changed after --as-of. Without it both are skipped and listed.
 *   ... --as-of <ISO date>
 *       when the import's content was written (default: the file's modification time). Rows updated after it are
 *       "newer than the import".
 *
 * The file is a bank file ({ "questions": [...] }) or a bare array of questions. Output is ids, field paths and counts only (never text, answers, aliases or rejects).
 * Exit code: 0 ok, 1 invalid entries / write conflicts, 2 bad arguments.
 */
import { readFileSync, statSync } from "node:fs";
import { describeError, formatImportReport, importEntries, runImport } from "../../app/lib/trivia/bank-import";

function usage(msg?: string): never {
  if (msg) console.error(msg);
  console.error("usage: npx tsx scripts/trivia/import-bank.ts <questions.json> [--apply] [--exposed] [--force] [--as-of <ISO date>]");
  process.exit(2);
}

async function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const asOfIdx = args.indexOf("--as-of");
  const asOfArg = asOfIdx >= 0 ? args[asOfIdx + 1] : undefined;
  const positional = args.filter((a, i) => !a.startsWith("--") && !(asOfIdx >= 0 && i === asOfIdx + 1));
  for (const f of flags) if (!["--apply", "--exposed", "--force", "--as-of"].includes(f)) usage(`unknown flag ${f}`);
  if (positional.length !== 1) usage("give exactly one JSON file");
  if (asOfIdx >= 0 && !asOfArg) usage("--as-of needs a date");
  if (!process.env.DATABASE_URL) usage("DATABASE_URL is not set");

  const file = positional[0];
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    // Not the message: JSON.parse quotes a slice of the file, which may be an answer.
    usage(`cannot read ${file}: ${(e as Error).name}${(e as { code?: string }).code ? ` ${(e as { code?: string }).code}` : ""}`);
  }
  const entries = importEntries(raw);
  if (!entries) usage(`${file} is neither { "questions": [...] } nor an array`);
  const asOf = asOfArg ? new Date(asOfArg) : statSync(file).mtime;
  if (Number.isNaN(asOf.getTime())) usage(`bad --as-of ${asOfArg}`);

  const opts = { apply: flags.has("--apply"), force: flags.has("--force"), exposed: flags.has("--exposed"), asOf };
  const report = await runImport(entries, opts);
  console.log(formatImportReport(report, opts));
  const { prisma } = await import("../../app/lib/db");
  await prisma.$disconnect();
  if (report.invalid.length || report.duplicates.length || report.conflicts.length) process.exit(1);
}

main().catch((e) => {
  console.error(`import failed: ${describeError(e)}`);
  process.exit(1);
});
