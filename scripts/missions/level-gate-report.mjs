#!/usr/bin/env node
/**
 * READ-ONLY report for the level gates (Community Call, 2026-10-26):
 *   level 4 needs a vouch received from another member,
 *   level 5 needs a Rare Pizza Box.
 * Writes NOTHING (only SELECTs; the box check, if asked for, only reads Alchemy).
 *
 * The gates do NOT demote anyone: members who were already paid a level 3
 * reward before LEVEL_GATE_START (app/lib/level-gate.ts) keep level 4+ without
 * a vouch, and those paid a level 4 reward keep level 5+ without a box. This
 * script counts the existing members each rule would have affected, so Snax can
 * decide whether to drop the grandfathering later.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/missions/level-gate-report.mjs
 *   DATABASE_URL=... ALCHEMY_API_KEY=... node scripts/missions/level-gate-report.mjs --check-boxes
 *
 * Options:
 *   --check-boxes   also look up Rare Pizza Boxes (one cached strict lookup per
 *                   member at level 5+; slow). Without it only the vouch count is exact.
 */
import { createRequire } from "node:module";
import { ensureTsRuntime, importApp } from "../unbelievaboat/run-ts.mjs";
import { parseArgs, die, loadDotenv } from "../unbelievaboat/args.mjs";

ensureTsRuntime(import.meta.url);
loadDotenv(createRequire(import.meta.url));
const args = parseArgs(process.argv.slice(2), { booleans: ["check-boxes", "help"] });
if (!process.env.DATABASE_URL) die("DATABASE_URL is not set");

const { prisma } = await importApp("app/lib/db.ts");
const { computeEarnedLevel, paidLevelOf } = await importApp("app/lib/missions.ts");
const { checkVouchReceived, checkRarePizzaBox, VOUCH_MIN_LEVEL, BOX_MIN_LEVEL, levelGateStart } =
  await importApp("app/lib/level-gate.ts");

try {
  const missions = await prisma.mission.findMany({ where: { isActive: true }, select: { id: true, level: true } });
  const approved = await prisma.missionCompletion.findMany({ where: { status: "APPROVED" }, select: { discordId: true, missionId: true } });
  const ledger = await prisma.transaction.findMany({ where: { type: "MISSION_REWARD" }, select: { userId: true, metadata: true, description: true } });

  const approvedBy = new Map();
  for (const c of approved) approvedBy.set(c.discordId, (approvedBy.get(c.discordId) ?? new Set()).add(c.missionId));
  const paidBy = new Map();
  for (const r of ledger) {
    const l = paidLevelOf(r);
    if (l !== null) paidBy.set(r.userId, (paidBy.get(r.userId) ?? new Set()).add(l));
  }

  let atLeast4 = 0, atLeast5 = 0, noVouch = 0, noVouchUnknown = 0, noBox = 0, noBoxUnknown = 0;
  const ids = new Set([...approvedBy.keys(), ...paidBy.keys()]);
  for (const id of ids) {
    const earned = computeEarnedLevel(missions, approvedBy.get(id) ?? new Set(), paidBy.get(id) ?? new Set());
    if (earned >= VOUCH_MIN_LEVEL) {
      atLeast4++;
      const v = await checkVouchReceived(id);
      if (v === "no") noVouch++;
      if (v === "error") noVouchUnknown++;
    }
    if (earned >= BOX_MIN_LEVEL) {
      atLeast5++;
      if (args["check-boxes"]) {
        const b = await checkRarePizzaBox(id);
        if (b === "no") noBox++;
        if (b === "error") noBoxUnknown++;
      }
    }
  }
  console.log(`Gate start (grandfathering cut-off): ${levelGateStart().toISOString()}`);
  console.log(`Members whose missions reach level ${VOUCH_MIN_LEVEL}+: ${atLeast4}`);
  console.log(`  ...with NO vouch received: ${noVouch}${noVouchUnknown ? ` (+${noVouchUnknown} lookups failed)` : ""}`);
  console.log(`Members whose missions reach level ${BOX_MIN_LEVEL}+: ${atLeast5}`);
  console.log(
    args["check-boxes"]
      ? `  ...with NO Rare Pizza Box: ${noBox}${noBoxUnknown ? ` (+${noBoxUnknown} lookups failed)` : ""}`
      : "  ...Rare Pizza Box not checked (pass --check-boxes)",
  );
  console.log("\nNone of these are demoted: they are grandfathered. Decision for Snax: keep that, or ask them to meet the gate.");
} finally {
  await prisma.$disconnect();
}
