#!/usr/bin/env node
/**
 * Issue Proof of Pizza redemption codes to members who already hold the item
 * (plans/proof-of-pizza-codes.md). DRY RUN BY DEFAULT: prints what it would do and writes nothing.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/proof-of-pizza/backfill-codes.mjs            # dry run
 *   DATABASE_URL=... node scripts/proof-of-pizza/backfill-codes.mjs --apply    # mint (and void extras)
 *   ... --apply --dm    # also DM each new code; needs DISCORD_BOT_TOKEN and PROOF_OF_PIZZA_DM_ENABLED=1
 *   ... --item 12       # dry run for an item before the setting proofOfPizza.itemId is set
 *
 * The item comes from the setting proofOfPizza.itemId (0 = off: nothing to do). --apply needs the setting
 * to be set, because the same helper the app uses (reconcileRedemptionCodes) does the work: it mints one
 * code per held unit and voids extras, so re-running is safe. Each member's codes are stamped with the
 * time of their earliest SHOP_PURCHASE of the item (else now). --dm never re-sends (dmSentAt).
 *
 * Output shows counts only: member ids are shortened and codes are never printed. Run against
 * production only with the owner's OK.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { ensureTsRuntime, importApp } from "../unbelievaboat/run-ts.mjs";
import { parseArgs, die, loadDotenv } from "../unbelievaboat/args.mjs";

ensureTsRuntime(import.meta.url);
loadDotenv(createRequire(import.meta.url));

const args = parseArgs(process.argv.slice(2), { booleans: ["apply", "dm", "help"] });
if (args.help) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0]);
  process.exit(0);
}
if (!process.env.DATABASE_URL) die("DATABASE_URL must be set");

const { prisma } = await importApp("app/lib/db.ts");
const { getSetting } = await importApp("app/lib/settings/index.ts");
const codes = await importApp("app/lib/redemption-codes.ts");
const dm = await importApp("app/lib/redemption-code-dm.ts");

const short = (id) => `...${String(id).slice(-4)}`;

try {
  const configured = Number(await getSetting("proofOfPizza.itemId")) || 0;
  const itemId = args.item ? Number(args.item) : configured;
  if (!Number.isInteger(itemId) || itemId <= 0) {
    console.log("proofOfPizza.itemId is 0 (off) and no --item given: nothing to do.");
    process.exit(0);
  }
  if (args.apply && itemId !== configured) die(`--apply needs the setting proofOfPizza.itemId to be ${itemId} (it is ${configured})`);

  const holders = await prisma.inventory.findMany({ where: { itemId, quantity: { gt: 0 } }, select: { userId: true, quantity: true } });
  const stale = await prisma.redemptionCode.findMany({ where: { itemId, status: "ACTIVE" }, select: { discordId: true } });
  const heldBy = new Set(holders.map((h) => h.userId));
  const staleIds = [...new Set(stale.map((s) => s.discordId))].filter((id) => !heldBy.has(id));
  console.log(`Item ${itemId}: ${holders.length} holder(s), ${staleIds.length} member(s) with codes but no unit left.`);

  const plan = [];
  for (const h of holders) {
    const active = await prisma.redemptionCode.count({ where: { discordId: h.userId, itemId, status: "ACTIVE" } });
    const buys = await prisma.transaction.findMany({ where: { userId: h.userId, type: "SHOP_PURCHASE" }, orderBy: { createdAt: "asc" }, select: { createdAt: true, metadata: true } });
    const first = buys.find((t) => Number(t.metadata?.itemId) === itemId);
    plan.push({ userId: h.userId, qty: h.quantity, active, acquiredAt: first?.createdAt ?? null });
  }
  for (const p of plan) {
    const delta = p.qty - p.active;
    const what = delta > 0 ? `mint ${delta}` : delta < 0 ? `void ${-delta}` : "already in step";
    console.log(`  ${short(p.userId)}: holds ${p.qty}, active codes ${p.active} -> ${what}${p.acquiredAt && delta > 0 ? ` (acquired ${p.acquiredAt.toISOString().slice(0, 10)})` : ""}`);
  }
  for (const id of staleIds) console.log(`  ${short(id)}: no unit left -> void their codes`);

  if (!args.apply) {
    console.log("\nDRY RUN - nothing written. Re-run with --apply.");
  } else {
    let minted = 0;
    let voided = 0;
    let dmSent = 0;
    const work = [...plan.map((p) => ({ userId: p.userId, acquiredAt: p.acquiredAt })), ...staleIds.map((userId) => ({ userId, acquiredAt: null }))];
    for (const w of work) {
      const r = await prisma.$transaction((tx) => codes.reconcileRedemptionCodes(tx, w.userId, { acquiredAt: w.acquiredAt ?? undefined }));
      minted += r.minted.length;
      voided += r.voided;
      if (args.dm && r.minted.length && (await dm.notifyRedemptionCodes(w.userId, r.minted))) dmSent++;
    }
    console.log(`\nMinted ${minted} code(s), voided ${voided}${args.dm ? `, DMs sent ${dmSent}` : ""}.`);
  }
} finally {
  await prisma.$disconnect();
}
