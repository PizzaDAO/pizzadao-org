#!/usr/bin/env node
/**
 * Mission verification backfill (plans/mission-verification.md §7, D7).
 * DRY RUN BY DEFAULT: writes NOTHING to the database.
 *
 * Runs every member's automatic mission verifiers (the same engine as the
 * "Check my progress" button and the nightly cron) and reports what would
 * happen:
 *   - every mission that would be newly approved, per mission;
 *   - every level that would be paid, in level order, with its PEP;
 *   - the items that would go to the human release queue instead of being
 *     paid: L6+ (HIGH_LEVEL), Discord accounts under 30 days (NEW_ACCOUNT)
 *     and missions a human rejected before (PREVIOUSLY_REJECTED);
 *   - approved role missions that would be flagged, and grandfathered
 *     no-proof 'auto' approvals the new verifiers would fail (information only).
 * Everything goes to a CSV (one row per member and action) plus a summary.
 *
 * THE OWNER MUST REVIEW THE DRY-RUN CSV BEFORE ANYONE RUNS --apply.
 *
 * --apply pays through the existing race-safe path (runVerifiers ->
 * settleLevels -> checkAndAwardLevelReward: wallet row lock + ledger marker,
 * exactly once per level, in level order). It requires
 *   --confirm-total <PEP>   the dry run's grand total, exactly, and
 *   MISSION_VERIFIERS_ENABLED=1 in the environment (the global kill switch).
 * It re-computes the plan first and refuses if the total changed. It works in
 * batches, saves a cursor on a VerifierRun row after each batch, and stops if
 * it would ever pay more than the confirmed total. Idempotent and resumable:
 * re-running the same command after an interruption continues from the
 * cursor; re-running after it finished finds nothing to do. Members get
 * in-app notifications only (no DMs, no #work posts).
 *
 * Usage:
 *   DATABASE_URL=... node scripts/missions/backfill.mjs                       # dry run -> CSV + summary
 *   DATABASE_URL=... node scripts/missions/backfill.mjs --max-level 2         # only approve missions up to L2
 *   DATABASE_URL=... MISSION_VERIFIERS_ENABLED=1 \
 *     node scripts/missions/backfill.mjs --apply --confirm-total 12345        # after the owner signed off
 *
 * Options:
 *   --out <file.csv>        where the CSV goes (default ./mission-backfill-<timestamp>.csv)
 *   --max-level <n>         only approve missions at level <= n (payouts above it are not unlocked)
 *   --batch <n>             members per batch (default 200)
 *   --concurrency <n>       members checked in parallel inside a batch (default 4)
 *
 * Needs the production env (vercel env pull to a file OUTSIDE the repo, then
 * `set -a; . /path/to/file; set +a`): DATABASE_URL, DISCORD_BOT_TOKEN and
 * DISCORD_GUILD_ID (role missions; without them those are left undecided) and
 * the Google Sheets credentials (memberIds for the wallet verifier).
 * Requires the 20261007000000_mission_phase2 migration (VerifierRun) for --apply.
 */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
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

const posInt = (v, name, fallback) => {
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) die(`--${name} must be a positive integer`);
  return n;
};
const batchSize = posInt(args.batch, "batch", 200);
const concurrency = posInt(args.concurrency, "concurrency", 4);
const maxLevel = args["max-level"] === undefined ? null : posInt(args["max-level"], "max-level");
const apply = !!args.apply;
const fmt = (n) => Number(n).toLocaleString("en-US");

const bulk = await importApp("app/lib/mission-verify/bulk.ts");
const { summarizeBackfill, backfillRows, toCsv, checkConfirmTotal } = await importApp("app/lib/mission-verify/backfill.ts");
const { roleHolders } = await importApp("app/lib/mission-verify/nightly.ts");
const { emptyStats, driveRun, prismaRunStore } = await importApp("app/lib/mission-verify/runs.ts");
const { missionVerifiersEnabled } = await importApp("app/lib/mission-verify/policy.ts");
const { prisma } = await importApp("app/lib/db.ts");

try {
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL).hostname;
    } catch {
      return "?";
    }
  })();
  console.log(`Database host: ${host}`);
  console.log(apply ? "Mode: APPLY (writes approvals and pays PEP)" : "Mode: DRY RUN (writes nothing)");
  if (apply && !missionVerifiersEnabled()) {
    die("--apply needs MISSION_VERIFIERS_ENABLED=1 in the environment (the automatic-verification kill switch).");
  }
  if (!process.env.DISCORD_BOT_TOKEN || !process.env.DISCORD_GUILD_ID) {
    console.warn("WARNING: DISCORD_BOT_TOKEN / DISCORD_GUILD_ID not set: role missions (L6.0, L7.0) are left undecided.");
  }

  // ---- context, once
  const [catalog, guildRoles, memberIds] = await Promise.all([
    bulk.loadMissionCatalog(),
    bulk.listGuildMemberRoles(),
    bulk.loadMemberIds(),
  ]);
  if (!guildRoles) console.warn("WARNING: the guild member listing is unavailable: role missions are left undecided.");
  if (!memberIds) console.warn("WARNING: the members sheet is unavailable: wallets are matched by discordId only.");
  const ctx = { catalog, guildRoles, memberIds };
  const missionIds = maxLevel === null ? undefined : catalog.verifierMissions.filter((m) => m.level <= maxLevel).map((m) => m.id);
  console.log(
    `Missions with a verifier: ${catalog.verifierMissions.map((m) => `L${m.level}.${m.index} ${m.verifierKey}`).join(", ")}` +
      (maxLevel === null ? "" : `\nOnly approving missions at level <= ${maxLevel}.`),
  );

  // ---- plan (a full dry run; also the first step of --apply)
  const candidates = await bulk.listCandidateMembers(await roleHolders(catalog, guildRoles));
  console.log(`\nChecking ${fmt(candidates.length)} members (dry run, batches of ${batchSize})...`);
  const outcomes = [];
  for (let i = 0; i < candidates.length; i += batchSize) {
    const ids = candidates.slice(i, i + batchSize);
    outcomes.push(
      ...(await bulk.checkMany(ids, { trigger: "backfill", dryRun: true, missionIds, auditLegacy: true, concurrency, ctx })),
    );
    process.stdout.write(`  ${fmt(Math.min(i + batchSize, candidates.length))}/${fmt(candidates.length)}\r`);
  }
  process.stdout.write("\n");
  const summary = summarizeBackfill(outcomes, catalog);
  printSummary(summary);

  if (!apply) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const out = path.resolve(typeof args.out === "string" ? args.out : `mission-backfill-${stamp}.csv`);
    writeFileSync(out, toCsv(backfillRows(outcomes, catalog)));
    const cmd = [
      "MISSION_VERIFIERS_ENABLED=1 node scripts/missions/backfill.mjs --apply",
      `--confirm-total ${summary.totalPep}`,
      ...(maxLevel === null ? [] : [`--max-level ${maxLevel}`]),
    ].join(" ");
    console.log(`
CSV written: ${out}
DRY RUN - nothing was written to the database.

================================ NEXT STEPS ================================
 1. The OWNER reviews the CSV above, row by row:
      approve  missions that would be approved automatically
      hold     verifier passed, but a human must release it (L6+ / account < 30 days)
      reopen   a human rejected it before; it goes back to the review queue
      pay      a level that would be paid, with its PEP
      flag     an approved role mission whose role is gone (flag only, nothing is taken back)
      legacy_auto_would_fail  old no-proof approvals the new checks would fail (information only)
 2. Check the totals and the top recipients printed above.
 3. ONLY AFTER THE OWNER HAS SIGNED OFF, apply with this exact total
    (same env and the same options as this dry run):

      ${cmd}

    --apply re-checks everything first and refuses if the total is no longer
    ${fmt(summary.totalPep)} PEP (e.g. members earned levels since): then run the
    dry run again and have the owner review the new CSV.
 4. If --apply is interrupted, re-run the same command: it resumes where it stopped.
=============================================================================`);
    await prisma.$disconnect();
    process.exit(0);
  }

  // ---- apply
  const store = prismaRunStore;
  const open = await store.findOpen("backfill", new Date(0), false);
  let run;
  if (open) {
    const confirmed = Number(open.stats.confirmedTotal);
    if ((open.stats.maxLevel ?? null) !== maxLevel) {
      die(`an unfinished backfill (run ${open.id}) used --max-level ${open.stats.maxLevel ?? "(none)"}; re-run with the same option.`);
    }
    const err = checkConfirmTotal(confirmed, args["confirm-total"]);
    if (err) die(`resuming backfill run ${open.id} (confirmed ${fmt(confirmed)} PEP, ${fmt(open.stats.pepPaid)} paid so far): ${err}`);
    if (summary.totalPep > confirmed - open.stats.pepPaid) {
      die(
        `the remaining plan (${fmt(summary.totalPep)} PEP) is more than what is left of the confirmed total ` +
          `(${fmt(confirmed - open.stats.pepPaid)} PEP). Something changed: review a fresh dry run before continuing.`,
      );
    }
    console.log(`\nResuming backfill run ${open.id} after ${open.cursor ?? "(start)"} (${fmt(open.stats.pepPaid)} PEP paid so far).`);
    run = open;
  } else {
    const err = checkConfirmTotal(summary.totalPep, args["confirm-total"]);
    if (err) die(err);
    run = await store.create("backfill", false, {
      ...emptyStats(),
      confirmedTotal: summary.totalPep,
      maxLevel,
      plannedMembers: summary.applyMembers.length,
    });
    console.log(`\nStarted backfill run ${run.id}: confirmed total ${fmt(summary.totalPep)} PEP.`);
  }
  const confirmedTotal = Number(run.stats.confirmedTotal);

  if (!(await store.claim(run.id, new Date(Date.now() + 6 * 3_600_000), new Date()))) {
    die(`backfill run ${run.id} is locked by another process (leaseUntil ${run.leaseUntil?.toISOString()}). Wait for it, or clear the lease if it crashed.`);
  }

  const members = bulk.membersAfter(summary.applyMembers, run.cursor);
  console.log(`Applying for ${fmt(members.length)} members in batches of ${batchSize}...`);
  let overCap = false;
  const res = await driveRun({
    run,
    store,
    members,
    batchSize,
    budgetMs: Infinity,
    processBatch: (ids) => bulk.checkMany(ids, { trigger: "backfill", dryRun: false, enabled: true, missionIds, concurrency, ctx }),
    onBatch: (batch, stats) => {
      console.log(
        `  up to ${batch[batch.length - 1]?.discordId}: members ${fmt(stats.members)}, approved ${fmt(stats.approved)}, held ${fmt(stats.held)}, ` +
          `reopened ${fmt(stats.reopened)}, PEP paid ${fmt(stats.pepPaid)} / ${fmt(confirmedTotal)}, errors ${stats.errors}`,
      );
      if (stats.pepPaid > confirmedTotal) {
        overCap = true;
        return false;
      }
    },
  });
  const s = res.run.stats;
  console.log(`
Backfill run ${run.id} ${res.done ? "FINISHED" : "STOPPED"}:
  members ${fmt(s.members)}, approved ${fmt(s.approved)}, held for release ${fmt(s.held)}, reopened ${fmt(s.reopened)}, flagged ${fmt(s.flagged)}
  levels paid ${JSON.stringify(s.levelsPaid)}
  PEP paid ${fmt(s.pepPaid)} (confirmed ${fmt(confirmedTotal)})
  errors ${s.errors}${s.errorSamples.length ? `\n    ${s.errorSamples.join("\n    ")}` : ""}`);
  if (overCap) die("STOPPED: paid more than the confirmed total. Investigate before continuing (the run stays open).");
  if (!res.done) die("not finished: re-run the same command to resume.");
} finally {
  await prisma.$disconnect();
}

function printSummary(s) {
  console.log(`\n================================ SUMMARY ================================`);
  console.log(`Members checked: ${fmt(s.members)}; with something to report: ${fmt(s.membersWithChanges)}`);
  console.log(`\nPer mission (newly approved / held for release / reopened / flagged / legacy 'auto' that would fail):`);
  for (const m of s.perMission) {
    console.log(`  L${m.level}.${m.index} ${m.title.slice(0, 50).padEnd(50)} ${String(m.approve).padStart(6)} ${String(m.hold).padStart(6)} ${String(m.reopen).padStart(6)} ${String(m.flag).padStart(6)} ${String(m.legacyWouldFail).padStart(6)}`);
  }
  console.log(`\nPEP payouts by level:`);
  if (!s.perLevel.length) console.log("  (none)");
  for (const l of s.perLevel) console.log(`  Level ${l.level}: ${fmt(l.members)} members x ${fmt(l.reward)} = ${fmt(l.pep)} PEP`);
  console.log(`  TOTAL: ${fmt(s.totalPep)} PEP`);
  console.log(
    `\nRelease queue (not paid; a reviewer releases them): L6+ ${s.held.HIGH_LEVEL}, account < 30 days ${s.held.NEW_ACCOUNT}, previously rejected ${s.held.PREVIOUSLY_REJECTED}`,
  );
  if (s.top.length) {
    console.log(`\nTop ${s.top.length} recipients:`);
    for (const t of s.top) console.log(`  ${t.discordId} (member ${t.memberId || "?"}): levels ${t.levels.join(", ")} = ${fmt(t.pep)} PEP`);
  }
  if (s.errors.length) {
    console.log(`\nErrors (${s.errors.length}; those members' missions were not decided):`);
    for (const e of s.errors.slice(0, 20)) console.log(`  ${e}`);
  }
  console.log(`==========================================================================`);
}
