#!/usr/bin/env node
/**
 * Import an UnbelievaBoat snapshot into $PEP. DRY RUN BY DEFAULT.
 *
 * Usage:
 *   node scripts/unbelievaboat/import.mjs --snapshot <ub-...json> --members <crew.csv> [options]
 *
 * Member mapping (who is "matched"):
 *   --members <file.csv>    Crew sheet downloaded as CSV (File > Download > CSV).
 *                           Same discordId -> memberId mapping the app uses.
 *   --members-from-sheet    Fetch the Crew tab's public CSV export instead
 *                           (MEMBERS_SHEET_ID overrides the default sheet).
 *   (DB)                    With DATABASE_URL set, anyone with an app User row
 *                           also counts as matched. --no-db skips the DB.
 *   Everyone else becomes a PENDING claim keyed by discordId, credited on
 *   first login once PEP_MIGRATION_CLAIMS=1.
 *
 * Conversion:
 *   --rate <decimal>        PEP per UB unit (default 1); floor per user
 *   --basis total|cash|bank which UB balance to convert (default total)
 *   --min <n>               skip users who would get < n PEP (default 1)
 *   --exclude <file|ids>    newline/comma separated Discord IDs to skip
 *
 * Output:
 *   --report-dir <dir>      where to write plan/diff CSVs (default: snapshot's dir)
 *   --show-all              print every row instead of the first 25 per group
 *
 * Writing (requires DATABASE_URL and the PendingPepClaim migration):
 *   --apply --confirm-total <N>   stage claims + credit matched users. N must equal
 *                                 the dry run's "PEP total to mint" (guards against
 *                                 applying a different plan than you reviewed).
 *   --rollback --confirm-rollback reverse every claim from this snapshot
 *                                 (CREDITED -> debit + MIGRATION_REVERSAL, PENDING -> VOID)
 *
 * Integrity: the snapshot's manifest (<name>.manifest.json) must match the
 * JSON/CSV sha256; with UB_SNAPSHOT_SIGNING_KEY set the HMAC is verified too.
 * --apply refuses to run without a matching manifest.
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ensureTsRuntime, importApp } from "./run-ts.mjs";
import { parseArgs, die, loadDotenv } from "./args.mjs";

ensureTsRuntime(import.meta.url);
loadDotenv(createRequire(import.meta.url));

const args = parseArgs(process.argv.slice(2), {
  booleans: ["apply", "rollback", "confirm-rollback", "no-db", "members-from-sheet", "show-all", "help"],
});
if (args.help || !args.snapshot) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0]);
  process.exit(args.help ? 0 : 1);
}
if (args.apply && args.rollback) die("--apply and --rollback are mutually exclusive");

const snap = await importApp("app/lib/unbelievaboat/snapshot.ts");
const planLib = await importApp("app/lib/unbelievaboat/plan.ts");
const membersLib = await importApp("app/lib/unbelievaboat/members-source.ts");
const reconcileLib = await importApp("app/lib/unbelievaboat/reconcile.ts");

// ---------------------------------------------------------------------------
// 1. Snapshot + integrity
// ---------------------------------------------------------------------------
const snapshotPath = path.resolve(args.snapshot);
const jsonText = readFileSync(snapshotPath, "utf8");
const snapshot = snap.validateSnapshot(JSON.parse(jsonText));
const stem = snapshotPath.replace(/\.json$/, "");
const manifestPath = `${stem}.manifest.json`;
const csvPath = `${stem}.csv`;
const snapshotSha = snap.sha256Hex(jsonText);

let manifestOk = false;
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const csvText = existsSync(csvPath) ? readFileSync(csvPath, "utf8") : null;
  const v = snap.verifyManifest(manifest, jsonText, csvText, process.env.UB_SNAPSHOT_SIGNING_KEY || null);
  manifestOk = v.ok;
  console.log(`Snapshot ${path.basename(snapshotPath)}  sha256 ${snapshotSha}`);
  console.log(`  manifest: ${v.ok ? "OK" : "MISMATCH"}${v.signed ? " (signed)" : " (unsigned)"}${v.errors.length ? " - " + v.errors.join("; ") : ""}`);
} else {
  console.log(`Snapshot ${path.basename(snapshotPath)}  sha256 ${snapshotSha}`);
  console.log(`  manifest: missing (${path.basename(manifestPath)})`);
}
if ((args.apply || args.rollback) && !manifestOk) die("refusing to write: snapshot manifest is missing or does not verify");

// ---------------------------------------------------------------------------
// 2. Known members (sheet CSV / public sheet export / app users in DB)
// ---------------------------------------------------------------------------
let sheetMembers = new Map();
if (args.members) {
  sheetMembers = membersLib.parseMembersCsv(readFileSync(path.resolve(args.members), "utf8"));
  console.log(`  members CSV: ${sheetMembers.size} members with a Discord ID`);
} else if (args["members-from-sheet"]) {
  const sheetId = (process.env.MEMBERS_SHEET_ID || "16BBOfasVwz8L6fPMungz_Y0EfF6Z9puskLAix3tCHzM").trim();
  const res = await fetch(membersLib.membersCsvUrl(sheetId));
  if (!res.ok) die(`members sheet CSV fetch failed: ${res.status}`);
  sheetMembers = membersLib.parseMembersCsv(await res.text());
  console.log(`  members sheet: ${sheetMembers.size} members with a Discord ID`);
} else {
  console.log("  members: none given (--members <crew.csv> or --members-from-sheet); only app users count as matched");
}

const useDb = !args["no-db"] && !!process.env.DATABASE_URL;
if ((args.apply || args.rollback) && !useDb) die("--apply/--rollback need DATABASE_URL (and not --no-db)");
let claimsLib = null;
let appUsers = new Set();
if (useDb) {
  claimsLib = await importApp("app/lib/unbelievaboat/claims.ts");
  appUsers = await claimsLib.getAppUserIds();
  console.log(`  app users (User rows): ${appUsers.size}`);
} else {
  console.log("  DB: not used (dry run without DATABASE_URL or --no-db)");
}
const known = membersLib.mergeKnownMembers(sheetMembers, appUsers);

// ---------------------------------------------------------------------------
// 3. Plan
// ---------------------------------------------------------------------------
let exclude = [];
if (args.exclude) {
  const raw = existsSync(args.exclude) ? readFileSync(args.exclude, "utf8") : String(args.exclude);
  exclude = raw.split(/[\s,]+/).map((s) => s.trim()).filter((s) => /^\d{5,25}$/.test(s));
}
const plan = planLib.buildMigrationPlan(snapshot, known, {
  rate: args.rate ? String(args.rate) : "1",
  basis: args.basis || "total",
  minAmount: args.min !== undefined ? Number(args.min) : 1,
  exclude,
});

console.log("");
console.log(planLib.formatPlanReport(plan, { showAll: !!args["show-all"] }));

const reportDir = path.resolve(args["report-dir"] || path.dirname(snapshotPath));
mkdirSync(reportDir, { recursive: true });
const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
const planCsvPath = path.join(reportDir, `${path.basename(stem)}.plan-${runStamp}.csv`);
writeFileSync(planCsvPath, planLib.planToCsv(plan));
console.log(`\nPer-user plan written to ${planCsvPath}`);

if (!args.apply && !args.rollback) {
  console.log(`\nDRY RUN - nothing was written to the database.`);
  console.log(`To apply: add --apply --confirm-total ${plan.summary.pepTotal}`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 4a. Rollback
// ---------------------------------------------------------------------------
if (args.rollback) {
  if (!args["confirm-rollback"]) die("--rollback also needs --confirm-rollback");
  const keys = plan.entries.map((e) => e.migrationKey);
  const results = [];
  for (const k of keys) results.push({ key: k, ...(await claimsLib.reverseClaim(k)) });
  const reversed = results.filter((r) => r.status === "reversed");
  const voided = results.filter((r) => r.status === "voided");
  const shortfall = reversed.reduce((a, r) => a + r.shortfall, 0);
  const outPath = path.join(reportDir, `${path.basename(stem)}.rollback-${runStamp}.json`);
  writeFileSync(outPath, JSON.stringify({ snapshotSha, results }, null, 2) + "\n");
  console.log(`\nRollback: ${reversed.length} reversed (${reversed.reduce((a, r) => a + r.debited, 0)} PEP debited, shortfall ${shortfall}), ${voided.length} pending voided`);
  console.log(`Report: ${outPath}`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 4b. Apply
// ---------------------------------------------------------------------------
if (String(args["confirm-total"]) !== String(plan.summary.pepTotal)) {
  die(`--confirm-total must equal the plan's PEP total (${plan.summary.pepTotal}); got ${args["confirm-total"] ?? "nothing"}`);
}
if (plan.summary.byStatus.invalid > 0) {
  die(`${plan.summary.byStatus.invalid} users are "invalid" (Infinity or > Int max). Exclude them or change --rate first.`);
}

const ids = plan.entries.map((e) => e.discordId);
const before = await claimsLib.getWallets(ids);

console.log("\nStaging claims ...");
const staged = await claimsLib.stageClaims(plan, snapshotSha);
console.log(`  created ${staged.created}, already staged ${staged.alreadyStaged}, conflicts ${staged.conflicts.length}`);
for (const c of staged.conflicts.slice(0, 20)) {
  console.log(`  conflict ${c.migrationKey}: existing ${c.existingAmount} (${c.existingStatus}) vs plan ${c.planAmount} - existing claim kept`);
}

console.log("Crediting matched members ...");
const credited = await claimsLib.creditMatched(plan.entries, (d, t) => {
  if (d % 100 === 0 || d === t) console.log(`  ${d}/${t}`);
});
console.log(`  credited ${credited.credited} (${credited.pepCredited} PEP), already ${credited.already}, missing ${credited.missing}, failed ${credited.failed.length}`);
for (const f of credited.failed) console.log(`  FAILED ${f.migrationKey}: ${f.error}`);

const after = await claimsLib.getWallets(ids);
const claims = await claimsLib.getClaims();
const creditedThisRun = new Set(credited.creditedKeys);
const report = reconcileLib.reconcile(plan, before, after, claims, creditedThisRun);
const diffPath = path.join(reportDir, `${path.basename(stem)}.diff-${runStamp}.csv`);
writeFileSync(diffPath, reconcileLib.reconcileToCsv(report));
const summaryPath = path.join(reportDir, `${path.basename(stem)}.result-${runStamp}.json`);
writeFileSync(
  summaryPath,
  JSON.stringify({ snapshotSha, rate: plan.rate, basis: plan.basis, plan: plan.summary, staged, credited, reconcile: report.totals }, null, 2) + "\n",
);

const t = report.totals;
console.log("\nReconciliation");
console.log(`  wallets before ${t.walletsBefore}  after ${t.walletsAfter}  delta ${t.actualDelta}  expected ${t.expectedDelta}`);
console.log(`  claims credited ${t.claimsCredited}  pending ${t.claimsPending} (${t.pepPending} PEP held)`);
console.log(`  per-user mismatches: ${t.mismatches}`);
console.log(`  diff: ${diffPath}`);
console.log(`  result: ${summaryPath}`);
process.exit(t.mismatches || credited.failed.length ? 2 : 0);
