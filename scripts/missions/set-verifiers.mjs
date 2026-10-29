#!/usr/bin/env node
/**
 * Mission data migration (verifiers, new missions, level titles). DRY RUN BY DEFAULT.
 *
 * The database is the source of truth once /admin/missions ships, so by default this ONLY
 * INSERTs missing missions (at the level's current database reward) and fills NULLs
 * (verifierKey with its proofKind, verifierParams), and rewords a title
 * that is still the untouched seed title. Re-running it never reverts an admin edit to
 * verifierParams, rewards, titles or the active flag. To restore the code values on purpose:
 *   --force-params   overwrite verifier, params, proofKind, titles, descriptions and level titles
 *                    from mission-config.ts (this mode keeps the title/reward abort described below)
 *   --fill-empty     also fill an EMPTY description / levelTitle on existing rows (off by default: an
 *                    admin may have cleared one on purpose; inserted rows always get theirs)
 *   --level-titles   (explicit) always overwrites the named levels' levelTitle
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
 *   New      INSERTs missions that are not in the seed (config entries with
 *            `insert`, e.g. L4.2 "Get vouched by a member" (vouch_received), L5.2 "Vouch for another member" (vouch_given), L5.3 "Own a Rare Pizza Box" (rare_pizza_box),
 *            L6.2 "Get vouched by 5 members" and L8.1 "Get vouched by 10 members" (vouch_received),
 *            each at its level's shared reward) when their (level, index) row is missing
 *   Titles   sets Mission.levelTitle on every row of the levels in
 *            MISSION_LEVEL_TITLES (L3-L6); --level-titles overrides / adds
 * and marks the grandfathered no-proof approvals (reviewedBy = 'auto', D6) as
 * source = 'AUTO'.
 *
 * With --force-params it ABORTS, changing nothing, if any (level, index) row has a title that is
 * neither the seed title nor the new title (production rows may have been
 * edited by hand: export them first, see plans/mission-verification.md §1),
 * or if a new mission's reward differs from its level's shared reward. In the default mode it
 * only aborts when a level's existing rows disagree on the reward.
 * Idempotent: a second run reports nothing to do.
 *
 * Requires Migration A (prisma/migrations/20261006000000_mission_verifiers)
 * to be applied first.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/missions/set-verifiers.mjs            # dry run: prints the plan
 *   DATABASE_URL=... node scripts/missions/set-verifiers.mjs --apply    # writes, in one transaction
 *   ... --level-titles '3="Title",4="Other title"'                      # rename levels without a code change
 *
 * Automatic approval stays off until missions.verifiersEnabled is set in
 * Vercel, and the semi verifiers never approve on their own, so applying this
 * alone changes no member's status or balance (a member who already finished
 * a level stays complete: a paid level counts as complete, and is never paid
 * twice).
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { ensureTsRuntime, importApp } from "../unbelievaboat/run-ts.mjs";
import { parseArgs, die, loadDotenv } from "../unbelievaboat/args.mjs";

ensureTsRuntime(import.meta.url);
loadDotenv(createRequire(import.meta.url));

const args = parseArgs(process.argv.slice(2), { booleans: ["apply", "help", "force-params", "fill-empty"] });
if (args.help) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0]);
  process.exit(0);
}
if (!process.env.DATABASE_URL) die("DATABASE_URL is not set");

const { planVerifierMigration, MISSION_VERIFIER_CONFIG, MISSION_LEVEL_TITLES, parseLevelTitlesArg } = await importApp(
  "app/lib/mission-verify/mission-config.ts",
);
const { prisma } = await importApp("app/lib/db.ts");
const { Prisma } = await import("@prisma/client");

let levelTitles = MISSION_LEVEL_TITLES;
let overrideLevelTitles;
if (args["level-titles"] !== undefined) {
  if (args["level-titles"] === true) die('--level-titles needs a value, e.g. --level-titles \'3="Title",4="Title"\'');
  try {
    overrideLevelTitles = parseLevelTitlesArg(String(args["level-titles"]));
    levelTitles = { ...MISSION_LEVEL_TITLES, ...overrideLevelTitles };
  } catch (err) {
    die(err.message);
  }
}

try {
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL).hostname;
    } catch {
      return "?";
    }
  })();
  console.log(`Database host: ${host}`);
  console.log(`Level titles: ${Object.entries(levelTitles).map(([l, t]) => `L${l} "${t}"`).join(", ")}`);

  const rows = await prisma.mission.findMany({
    select: {
      id: true, level: true, index: true, title: true, description: true, verifierKey: true, verifierParams: true, proofKind: true,
      levelTitle: true, reward: true,
    },
    orderBy: [{ level: "asc" }, { index: "asc" }],
  });
  const plan = planVerifierMigration(rows, MISSION_VERIFIER_CONFIG, levelTitles, {
    force: !!args["force-params"],
    overrideLevelTitles,
    fillEmpty: !!args["fill-empty"],
  });
  console.log(args["force-params"] ? "Mode: --force-params (restoring code values)" : "Mode: safe (insert missing, fill empty; admin edits are kept)");
  const legacyAuto = await prisma.missionCompletion.count({ where: { reviewedBy: "auto", source: { not: "AUTO" } } });

  console.log(`\n${rows.length} mission rows.`);
  if (plan.missing.length) console.log(`Not found (skipped): ${plan.missing.join(", ")}`);
  if (plan.unchanged.length) console.log(`Already up to date: ${plan.unchanged.join(", ")}`);
  for (const i of plan.inserts) {
    const d = i.data;
    console.log(
      `  L${i.level}.${i.index} INSERT: "${d.title}", reward ${d.reward}, levelTitle ${d.levelTitle ? `"${d.levelTitle}"` : "null"}, ` +
        `verifier ${d.verifierKey} ${JSON.stringify(d.verifierParams)}, proofKind ${d.proofKind}`,
    );
  }
  for (const u of plan.updates) console.log(`  L${u.level}.${u.index} (id ${u.id}): ${u.changes.join("; ")}`);
  console.log(`Grandfathered 'auto' approvals to mark source=AUTO: ${legacyAuto}`);

  if (plan.errors.length) {
    console.error("\nMismatch, nothing changed:");
    for (const e of plan.errors) console.error(`  ${e}`);
    die("fix the rows (or mission-config.ts) and re-run");
  }

  const todo = `${plan.inserts.length} new missions, ${plan.updates.length} mission updates and ${legacyAuto} completions`;
  if (!plan.updates.length && !plan.inserts.length && !legacyAuto) {
    console.log("\nNothing to do.");
  } else if (!args.apply) {
    console.log(`\nDRY RUN - nothing was written. Re-run with --apply to write ${todo}.`);
  } else {
    await prisma.$transaction(async (tx) => {
      for (const u of plan.updates) {
        // Only the changed fields; verifierParams null means SQL NULL.
        const data = { ...u.data };
        if ("verifierParams" in data) data.verifierParams = data.verifierParams ?? Prisma.DbNull;
        // Re-assert the title inside the transaction (guards against an edit since the read).
        const n = await tx.mission.updateMany({
          where: { id: u.id, level: u.level, index: u.index, title: rows.find((r) => r.id === u.id).title },
          data,
        });
        if (n.count !== 1) throw new Error(`L${u.level}.${u.index} changed while migrating; rolled back`);
      }
      for (const i of plan.inserts) {
        // @@unique([level, index]): a row created since the read fails the insert and rolls everything back.
        await tx.mission.create({ data: { ...i.data, verifierParams: i.data.verifierParams ?? Prisma.DbNull } });
      }
      await tx.missionCompletion.updateMany({ where: { reviewedBy: "auto", source: { not: "AUTO" } }, data: { source: "AUTO" } });
    });
    console.log(`\nApplied: ${todo}.`);
  }
} finally {
  await prisma.$disconnect();
}
