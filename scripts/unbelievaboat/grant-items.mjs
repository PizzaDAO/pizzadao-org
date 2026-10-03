#!/usr/bin/env node
/**
 * Grant existing UnbelievaBoat item holdings as $PEP shop inventory.
 * DRY RUN BY DEFAULT.
 *
 * Without a UB API token, holdings can't be exported, so staff enter them by
 * hand (e.g. from UB's /inventory of each holder or the money audit log) in a
 * CSV:
 *
 *   discordId,item,qty
 *   100000000000000001,Rare Pizza Box,1
 *   100000000000000002,"Global Pizza Party T-shirt",2
 *
 * Header row optional, # comments allowed. Item names match the shop's item
 * names ignoring case, spaces and punctuation (create the items first: see
 * seed-store.mjs). Keep the CSV out of the repo (it lists members' IDs).
 *
 * Usage:
 *   DATABASE_URL=... node scripts/unbelievaboat/grant-items.mjs --csv holdings.csv [--apply] [--note "UB carry-over"]
 *
 * Idempotent: each (member, item) is granted once (ItemGrant.grantKey), in the
 * same DB transaction as the Inventory increment. Re-running is safe; a row
 * whose qty differs from what was already granted is reported as a conflict
 * and never applied (fix it by hand). Grants don't change shop stock or any
 * wallet. --apply refuses to run while the CSV has errors, unknown items or
 * duplicate rows. Exit code 2 if there are conflicts.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ensureTsRuntime, importApp } from "./run-ts.mjs";
import { parseArgs, die, loadDotenv } from "./args.mjs";

ensureTsRuntime(import.meta.url);
loadDotenv(createRequire(import.meta.url));

const args = parseArgs(process.argv.slice(2), { booleans: ["apply", "help"] });
if (args.help || !args.csv) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0]);
  process.exit(args.help ? 0 : 1);
}
if (!process.env.DATABASE_URL) die("DATABASE_URL must be set (the dry run reads shop items and existing grants)");

const grants = await importApp("app/lib/shop-grants.ts");
const { prisma } = await importApp("app/lib/db.ts");

const { rows, errors } = grants.parseGrantCsv(readFileSync(path.resolve(args.csv), "utf8"));
console.log(`CSV ${path.basename(args.csv)}: ${rows.length} row(s), ${errors.length} error(s)`);
for (const e of errors) console.log(`  ! ${e}`);

let exitCode = 0;
try {
  const plan = await grants.planGrants(rows);
  const by = (s) => plan.filter((p) => p.status === s);
  for (const p of plan) {
    const what = `${p.discordId}  ${p.qty} x ${p.itemName ?? p.item}`;
    const tag = { grant: "+", already_granted: "=", conflict: "!", unknown_item: "?", duplicate_in_csv: "!" }[p.status];
    console.log(`  ${tag} line ${p.line}: ${what}  [${p.status}]${p.detail ? "  " + p.detail : ""}`);
  }
  console.log(
    `\nTo grant: ${by("grant").length}  already granted: ${by("already_granted").length}  conflicts: ${by("conflict").length}` +
      `  unknown items: ${by("unknown_item").length}  duplicates: ${by("duplicate_in_csv").length}`,
  );
  if (by("conflict").length) exitCode = 2;

  if (!args.apply) {
    console.log("\nDRY RUN - nothing written. Re-run with --apply.");
  } else {
    if (errors.length || by("unknown_item").length || by("duplicate_in_csv").length) {
      die("fix the CSV errors, unknown items and duplicate rows before --apply");
    }
    let granted = 0;
    let raced = 0;
    for (const p of by("grant")) {
      if (await grants.applyGrant(p, "unbelievaboat", args.note ? String(args.note) : "UnbelievaBoat holding")) granted++;
      else raced++;
    }
    console.log(`\nGranted ${granted} holding(s)${raced ? `, ${raced} already granted by a concurrent run` : ""}.`);
  }
} finally {
  await prisma.$disconnect();
}
process.exit(exitCode);
