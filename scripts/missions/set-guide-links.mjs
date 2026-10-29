#!/usr/bin/env node
/**
 * Seed the default "how to do this" handbook link on each mission (Mission.guideHref).
 * DRY RUN BY DEFAULT: it prints the plan and writes nothing without --apply.
 *
 * Fills NULLs only, matching rows by (level, index) from app/lib/mission-verify/mission-config.ts
 * (the guideHref on each config entry). A row that already has a link is never touched, and neither
 * is a row whose link an admin has ever edited (the audit log has a `mission:<id>:guideHref` entry),
 * so an admin who cleared a link on purpose does not get it back. Idempotent: a second run
 * reports nothing to do.
 *
 * Order: apply the migration prisma/migrations/20261102300000_mission_guide_href, then merge and
 * deploy the handbook pages (a link to a page that does not exist yet would 404), then run this.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/missions/set-guide-links.mjs            # dry run: prints the plan
 *   DATABASE_URL=... node scripts/missions/set-guide-links.mjs --apply    # writes, in one transaction
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

const { planGuideLinks, MISSION_VERIFIER_CONFIG } = await importApp("app/lib/mission-verify/mission-config.ts");
const { parseGuideHref } = await importApp("app/lib/guide-href.ts");
const { prisma } = await importApp("app/lib/db.ts");

try {
  // Never write a link the admin editor would refuse.
  for (const c of MISSION_VERIFIER_CONFIG) {
    if (c.guideHref && !parseGuideHref(c.guideHref).ok) die(`L${c.level}.${c.index}: invalid guideHref ${c.guideHref}`);
  }

  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL).hostname;
    } catch {
      return "?";
    }
  })();
  console.log(`Database host: ${host}`);

  const rows = await prisma.mission.findMany({
    select: { id: true, level: true, index: true, guideHref: true },
    orderBy: [{ level: "asc" }, { index: "asc" }],
  });
  // A mission whose guideHref was ever edited in the admin editor is left alone (it may have been cleared on purpose).
  const edited = await prisma.appSettingChange.findMany({
    where: { key: { in: rows.map((r) => `mission:${r.id}:guideHref`) } },
    select: { key: true },
  });
  const editedIds = new Set(edited.map((e) => Number(e.key.split(":")[1])));
  const plan = planGuideLinks(rows, MISSION_VERIFIER_CONFIG, editedIds);

  console.log(`\n${rows.length} mission rows.`);
  if (plan.missing.length) console.log(`Not found (skipped): ${plan.missing.join(", ")}`);
  if (plan.kept.length) console.log(`Already have a link (kept): ${plan.kept.join(", ")}`);
  for (const u of plan.updates) console.log(`  L${u.level}.${u.index} (id ${u.id}): guideHref -> ${u.guideHref}`);

  if (!plan.updates.length) {
    console.log("\nNothing to do.");
  } else if (!args.apply) {
    console.log(`\nDRY RUN - nothing was written. Re-run with --apply to write ${plan.updates.length} links.`);
  } else {
    await prisma.$transaction(async (tx) => {
      for (const u of plan.updates) {
        // Re-assert NULL inside the transaction (guards against an admin edit since the read).
        const n = await tx.mission.updateMany({ where: { id: u.id, guideHref: null }, data: { guideHref: u.guideHref } });
        if (n.count !== 1) throw new Error(`L${u.level}.${u.index} changed while seeding; rolled back`);
      }
    });
    console.log(`\nApplied: ${plan.updates.length} links.`);
  }
} finally {
  await prisma.$disconnect();
}
