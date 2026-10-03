#!/usr/bin/env node
/**
 * Mission verification data migration (Phases 1 and 4). DRY RUN BY DEFAULT.
 *
 * Sets Mission.verifierKey / verifierParams / proofKind (and the reworded
 * titles / descriptions) on the seeded missions, keyed by (level, index), per
 * app/lib/mission-verify/mission-config.ts:
 *   Phase 1  L1.1 x_linked (reworded, D1), L2.0 / L5.0 attendance_count,
 *            L3.0 discord_message, L6.0 / L7.0 discord_role, L8.0 manual
 *   Phase 4  L2.1 social_post, L4.1 poap_drop, L5.1 media_proof, L6.1 gpp_host
 *            (semi-automatic: pre-checks on submit, a reviewer approves), and
 *            L3.1 referral (now real) with a description that explains the
 *            invite link
 * and marks the grandfathered no-proof approvals (reviewedBy = 'auto', D6) as
 * source = 'AUTO'.
 *
 * It ABORTS, changing nothing, if any (level, index) row has a title that is
 * neither the seed title nor the new title (production rows may have been
 * edited by hand: export them first, see plans/mission-verification.md §1).
 * Idempotent: a second run reports nothing to do. Already on the Phase 1
 * config, it only reports the Phase 4 rows.
 *
 * Requires Migration A (prisma/migrations/20261006000000_mission_verifiers)
 * to be applied first.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/missions/set-verifiers.mjs            # dry run: prints the plan
 *   DATABASE_URL=... node scripts/missions/set-verifiers.mjs --apply    # writes, in one transaction
 *
 * Automatic approval stays off until MISSION_VERIFIERS_ENABLED=1 is set in
 * Vercel, and the semi verifiers never approve on their own, so applying this
 * alone changes no member's status or balance.
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

const { planVerifierMigration } = await importApp("app/lib/mission-verify/mission-config.ts");
const { prisma } = await importApp("app/lib/db.ts");
const { Prisma } = await import("@prisma/client");

try {
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL).hostname;
    } catch {
      return "?";
    }
  })();
  console.log(`Database host: ${host}`);

  const rows = await prisma.mission.findMany({
    select: { id: true, level: true, index: true, title: true, description: true, verifierKey: true, verifierParams: true, proofKind: true },
    orderBy: [{ level: "asc" }, { index: "asc" }],
  });
  const plan = planVerifierMigration(rows);
  const legacyAuto = await prisma.missionCompletion.count({ where: { reviewedBy: "auto", source: { not: "AUTO" } } });

  console.log(`\n${rows.length} mission rows.`);
  if (plan.missing.length) console.log(`Not found (skipped): ${plan.missing.join(", ")}`);
  if (plan.unchanged.length) console.log(`Already up to date: ${plan.unchanged.join(", ")}`);
  for (const u of plan.updates) console.log(`  L${u.level}.${u.index} (id ${u.id}): ${u.changes.join("; ")}`);
  console.log(`Grandfathered 'auto' approvals to mark source=AUTO: ${legacyAuto}`);

  if (plan.errors.length) {
    console.error("\nTitle mismatch, nothing changed:");
    for (const e of plan.errors) console.error(`  ${e}`);
    die("fix the rows (or mission-config.ts) and re-run");
  }

  if (!plan.updates.length && !legacyAuto) {
    console.log("\nNothing to do.");
  } else if (!args.apply) {
    console.log(`\nDRY RUN - nothing was written. Re-run with --apply to update ${plan.updates.length} missions and ${legacyAuto} completions.`);
  } else {
    await prisma.$transaction(async (tx) => {
      for (const u of plan.updates) {
        // Re-assert the title inside the transaction (guards against an edit since the read).
        const n = await tx.mission.updateMany({
          where: { id: u.id, level: u.level, index: u.index, title: rows.find((r) => r.id === u.id).title },
          data: { ...u.data, verifierParams: u.data.verifierParams ?? Prisma.DbNull },
        });
        if (n.count !== 1) throw new Error(`L${u.level}.${u.index} changed while migrating; rolled back`);
      }
      await tx.missionCompletion.updateMany({ where: { reviewedBy: "auto", source: { not: "AUTO" } }, data: { source: "AUTO" } });
    });
    console.log(`\nApplied: ${plan.updates.length} missions, ${legacyAuto} completions marked source=AUTO.`);
  }
} finally {
  await prisma.$disconnect();
}
