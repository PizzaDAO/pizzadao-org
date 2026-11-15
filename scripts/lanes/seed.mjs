#!/usr/bin/env node
/**
 * Seed the six "find your lane" tracks (plans/lane-cards-mission-onboarding.md).
 * DRY RUN BY DEFAULT: it prints the plan and writes nothing without --apply.
 *
 * Inserts each lane whose slug is missing as UNPUBLISHED, with draft steps, from
 * app/lib/lanes/seed-data.ts. A lane that already exists is never touched (the database is the
 * source of truth after the first run; edit lanes in /admin/lanes). Each lane's mission is looked
 * up by exact title; a mission that does not exist yet is reported and the lane is seeded
 * guide-only (create the mission in /admin/missions, then pick it in /admin/lanes). Idempotent:
 * a second run reports nothing to do.
 *
 * Order: apply the migration prisma/migrations/20261215090000_lanes first. Do not run --apply
 * against production without the go-ahead.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/lanes/seed.mjs            # dry run: prints the plan
 *   DATABASE_URL=... node scripts/lanes/seed.mjs --apply    # writes, one transaction per lane
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

const { planLaneSeed } = await importApp("app/lib/lanes/seed-data.ts");
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

  const [lanes, missions] = await Promise.all([
    prisma.lane.findMany({ select: { slug: true } }),
    prisma.mission.findMany({ select: { id: true, title: true } }),
  ]);
  const plan = planLaneSeed(lanes.map((l) => l.slug), missions);

  if (plan.kept.length) console.log(`\nAlready in the database (left alone): ${plan.kept.join(", ")}`);
  if (plan.missingMissions.length) console.log(`\nMissions not found (create them in /admin/missions, then pick them in /admin/lanes):\n  - ${plan.missingMissions.join("\n  - ")}`);
  for (const c of plan.create) {
    console.log(
      `\n  ${c.lane.slug}: "${c.lane.title}" (unpublished, ${c.lane.steps.length} draft steps), mission ${c.missionId ?? "none (guide only)"}, more missions [${c.stretchMissionIds.join(", ")}]`,
    );
  }

  if (!plan.create.length) {
    console.log("\nNothing to do.");
  } else if (!args.apply) {
    console.log(`\nDRY RUN - nothing was written. Re-run with --apply to insert ${plan.create.length} lanes.`);
  } else {
    for (const c of plan.create) {
      await prisma.$transaction(async (tx) => {
        // Re-check inside the transaction: another run or an admin may have created it since the read.
        if (await tx.lane.findUnique({ where: { slug: c.lane.slug }, select: { slug: true } })) return;
        await tx.lane.create({
          data: {
            slug: c.lane.slug,
            tag: c.lane.tag,
            title: c.lane.title,
            summary: c.lane.summary,
            position: c.lane.position,
            crewId: c.lane.crewId,
            missionId: c.missionId,
            stretchMissionIds: c.stretchMissionIds,
            published: false,
            updatedBy: "seed",
            steps: {
              create: c.lane.steps.map((s, i) => ({
                position: i + 1,
                title: s.title,
                body: s.body,
                linkHref: s.linkHref ?? null,
                linkLabel: s.linkLabel ?? null,
                kind: s.kind,
              })),
            },
          },
        });
      });
    }
    console.log(`\nApplied: ${plan.create.length} lanes (all unpublished).`);
  }
} finally {
  await prisma.$disconnect();
}
