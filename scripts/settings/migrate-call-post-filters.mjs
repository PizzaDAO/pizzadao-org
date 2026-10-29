#!/usr/bin/env node
/**
 * Copy the call post filter from the CallPostFilter table into the private setting
 * `calls.postFilter` (plans/app-settings.md, phase 5). DRY RUN BY DEFAULT.
 *
 * The filter is private editorial content. This script reads it from the database and writes it back
 * to the database; it NEVER prints any of the text. Output is counts only (how many entries are in
 * each list) plus yes/no facts. Do not redirect it into a ticket or a log that shows more.
 *
 * What it does:
 *   - no CallPostFilter row, or all three lists empty: nothing to copy, exits.
 *   - the setting already has a row: leaves it alone (saved edits win), says whether it still equals the table.
 *   - otherwise: with --apply, saves the three lists as `calls.postFilter` through the same code path as
 *     the admin page (validated, audited with the values masked). The write only happens if the setting
 *     still has no row at that moment (guards against a concurrent edit).
 * The table and its model are NOT touched or dropped; until the setting has a row the app keeps
 * reading the table, so running this later than the deploy is safe. Re-running it is a no-op.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/settings/migrate-call-post-filters.mjs            # dry run: counts only
 *   DATABASE_URL=... node scripts/settings/migrate-call-post-filters.mjs --apply    # writes the setting
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { ensureTsRuntime, importApp } from "../unbelievaboat/run-ts.mjs";
import { parseArgs, die, loadDotenv } from "../unbelievaboat/args.mjs";

ensureTsRuntime(import.meta.url);
loadDotenv(createRequire(import.meta.url));

const args = parseArgs(process.argv.slice(2), { booleans: ["apply", "help"] });
if (args.help) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0]);
  process.exit(0);
}
if (!process.env.DATABASE_URL) die("DATABASE_URL is not set");

const KEY = "calls.postFilter";
const LISTS = ["excludedCrewIds", "excludedCrewLabelTerms", "blockedTerms"];
const ACTOR = "script:migrate-call-post-filters";

const { prisma } = await importApp("app/lib/db.ts");
const { cleanList } = await importApp("app/lib/calls/post-filter-lists.ts");
const { saveSetting } = await importApp("app/lib/settings/store.ts");

const counts = (f) => LISTS.map((k) => `${k} ${f[k].length}`).join(", ");
const clean = (v) => Object.fromEntries(LISTS.map((k) => [k, cleanList(v?.[k])]));

try {
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL).hostname;
    } catch {
      return "?";
    }
  })();
  console.log(`Database host: ${host}`);
  console.log(args.apply ? "Mode: --apply" : "Mode: dry run (add --apply to write)");

  const row = await prisma.callPostFilter.findUnique({ where: { id: 1 } });
  const table = row ? clean(row) : null;
  const existing = await prisma.appSetting.findUnique({ where: { key: KEY } });

  console.log(`Table row: ${table ? `found (${counts(table)})` : "none"}`);

  if (existing) {
    const saved = clean(existing.value);
    console.log(`Setting ${KEY}: already saved (${counts(saved)})`);
    if (table) console.log(`Saved setting equals the table: ${JSON.stringify(saved) === JSON.stringify(table) ? "yes" : "no"}`);
    console.log("Nothing to do: the saved setting is left as it is.");
  } else if (!table || LISTS.every((k) => table[k].length === 0)) {
    console.log("Nothing to copy: no table row, or all three lists are empty. The app already behaves as if no filter is set.");
  } else if (!args.apply) {
    console.log(`Would save ${KEY} with ${counts(table)}. Re-run with --apply to write it.`);
  } else {
    await saveSetting(KEY, table, ACTOR, { note: "copied from the CallPostFilter table", expectedUpdatedAt: null });
    const after = await prisma.appSetting.findUnique({ where: { key: KEY } });
    const saved = clean(after?.value);
    console.log(`Saved ${KEY} (${counts(saved)}). Equals the table: ${JSON.stringify(saved) === JSON.stringify(table) ? "yes" : "no"}`);
    console.log("The app reads the setting from now on (within about 30 seconds). The table is unchanged.");
  }
} catch (err) {
  // Never echo the message: it could carry text. Name and status only.
  console.error(`Failed (${err?.name ?? "Error"}${err?.status ? ` ${err.status}` : ""}). Nothing was changed if this happened before the save.`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
