#!/usr/bin/env node
/**
 * READ-ONLY report for the two missions added to levels 4 and 5 (Community
 * Call, 2026-10-26): L4.2 "Get vouched by a member" (vouch_received) and L5.3
 * "Own a Rare Pizza Box" (rare_pizza_box).
 *
 * Writes NOTHING: only SELECTs against the database, a read of the members
 * sheet, and (with --check-boxes) read-only Alchemy calls. No wallet rows are
 * cached and nothing is written to the KV cache.
 *
 * Nobody is demoted by adding the missions: a level whose reward was already
 * paid counts as complete (computeCurrentLevel / the MISSION_REWARD ledger
 * marker), whatever missions the level has now. This report shows:
 *   - members already PAST level 4 / 5 (reward paid): safe, and how many of
 *     them have no vouch received / no Rare Pizza Box (information only);
 *   - members who finished the OTHER missions of level 4 / 5 but are NOT paid
 *     yet: they now wait for the new mission (the people the change affects).
 *
 * Usage:
 *   DATABASE_URL=... node scripts/missions/level-gate-report.mjs
 *   DATABASE_URL=... ALCHEMY_API_KEY=... node scripts/missions/level-gate-report.mjs --check-boxes
 *
 * Options:
 *   --check-boxes   also look up Rare Pizza Boxes (strict, uncached, read-only;
 *                   one lookup per member who is past or waiting on level 5; slow).
 */
import { createRequire } from "node:module";
import { ensureTsRuntime, importApp } from "../unbelievaboat/run-ts.mjs";
import { parseArgs, die, loadDotenv } from "../unbelievaboat/args.mjs";

ensureTsRuntime(import.meta.url);
loadDotenv(createRequire(import.meta.url));
const args = parseArgs(process.argv.slice(2), { booleans: ["check-boxes", "help"] });
if (!process.env.DATABASE_URL) die("DATABASE_URL is not set");

const { prisma } = await importApp("app/lib/db.ts");
const { paidLevelOf } = await importApp("app/lib/missions.ts");
const { checkRarePizzaBox } = await importApp("app/lib/rare-pizza-box.ts");
const { loadMemberIds } = await importApp("app/lib/mission-verify/bulk.ts");

try {
  const missions = await prisma.mission.findMany({
    where: { isActive: true },
    select: { id: true, level: true, index: true, verifierKey: true },
  });
  const vouchMission = missions.find((m) => m.verifierKey === "vouch_received");
  const boxMission = missions.find((m) => m.verifierKey === "rare_pizza_box");
  if (!vouchMission || !boxMission) {
    console.log(
      `Note: ${!vouchMission ? "L4.2 vouch_received " : ""}${!boxMission ? "L5.3 rare_pizza_box " : ""}not in the database yet (run scripts/missions/set-verifiers.mjs --apply first); counting as if added.`,
    );
  }
  const newIds = new Set([vouchMission?.id, boxMission?.id].filter((x) => x !== undefined));
  const levelIds = (level) => missions.filter((m) => m.level === level && !newIds.has(m.id)).map((m) => m.id);
  const l4 = levelIds(4);
  const l5 = levelIds(5);

  const approved = await prisma.missionCompletion.findMany({ where: { status: "APPROVED" }, select: { discordId: true, missionId: true } });
  const ledger = await prisma.transaction.findMany({ where: { type: "MISSION_REWARD" }, select: { userId: true, metadata: true, description: true } });
  const approvedBy = new Map();
  for (const c of approved) approvedBy.set(c.discordId, (approvedBy.get(c.discordId) ?? new Set()).add(c.missionId));
  const paidBy = new Map();
  for (const r of ledger) {
    const l = paidLevelOf(r);
    if (l !== null) paidBy.set(r.userId, (paidBy.get(r.userId) ?? new Set()).add(l));
  }
  const memberIds = await loadMemberIds(); // read-only members sheet; null if unreadable
  if (!memberIds) console.warn("WARNING: the members sheet is unreadable: vouch and box counts below are not exact.");

  const gotVouch = async (memberId) =>
    memberId
      ? (await prisma.vouch.count({ where: { followeeId: memberId, followerId: { not: memberId }, source: "PIZZADAO" } })) > 0
      : false;

  const out = { past4: 0, past4NoVouch: 0, wait4: 0, wait4NoVouch: 0, past5: 0, past5NoBox: 0, past5Unchecked: 0, wait5: 0, wait5NoBox: 0 };
  const ids = new Set([...approvedBy.keys(), ...paidBy.keys()]);
  for (const id of ids) {
    const paid = paidBy.get(id) ?? new Set();
    const done = approvedBy.get(id) ?? new Set();
    const memberId = memberIds?.get(id) ?? null;
    const doneOthers = (list) => list.length > 0 && list.every((m) => done.has(m));
    const prior = [1, 2, 3].every((l) => paid.has(l));
    if (paid.has(4)) {
      out.past4++;
      if (!(await gotVouch(memberId))) out.past4NoVouch++;
    } else if (prior && doneOthers(l4)) {
      out.wait4++;
      if (!(await gotVouch(memberId))) out.wait4NoVouch++;
    }
    const checkBox = async (bump) => {
      if (!args["check-boxes"]) return void out.past5Unchecked++;
      if (!memberId) return void bump();
      if ((await checkRarePizzaBox(memberId, { cache: false })) === "no") bump();
    };
    if (paid.has(5)) {
      out.past5++;
      await checkBox(() => out.past5NoBox++);
    } else if (paid.has(4) && doneOthers(l5)) {
      out.wait5++;
      await checkBox(() => out.wait5NoBox++);
    }
  }
  console.log(`Members already past level 4 (reward paid, keep their level): ${out.past4}`);
  console.log(`  ...with no vouch received (information only): ${out.past4NoVouch}`);
  console.log(`Members who finished the other level 4 missions but are not paid yet: ${out.wait4}`);
  console.log(`  ...of those, no vouch received yet (held until vouched): ${out.wait4NoVouch}`);
  console.log(`Members already past level 5 (reward paid, keep their level): ${out.past5}`);
  console.log(`Members who finished the other level 5 missions but are not paid yet: ${out.wait5}`);
  if (args["check-boxes"]) {
    console.log(`  past level 5 with no Rare Pizza Box (information only): ${out.past5NoBox}`);
    console.log(`  waiting on level 5 with no Rare Pizza Box (held until they own one): ${out.wait5NoBox}`);
  } else {
    console.log("  (Rare Pizza Boxes not checked: pass --check-boxes)");
  }
} finally {
  await prisma.$disconnect();
}
