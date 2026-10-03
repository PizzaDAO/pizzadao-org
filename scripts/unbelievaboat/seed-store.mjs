#!/usr/bin/env node
/**
 * Recreate UnbelievaBoat's 4 store items in the $PEP shop. DRY RUN BY DEFAULT.
 *
 * The shop's source of truth is the "Shop" tab of the jobs/shop Google Sheet
 * (scripts/jobs-sync/Code.js pushes it to POST /api/shop/sync on edit). The
 * sync DEACTIVATES any item that is not in the sheet, so the durable way to add
 * these items is to paste the rows this script prints into the Shop tab.
 * --apply additionally upserts them straight into the DB (useful before the
 * sheet is updated, or on a Neon branch for testing); the next sheet sync then
 * takes over.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/unbelievaboat/seed-store.mjs [--rare-box-stock N] [--apply]
 *
 *   --rare-box-stock N  remaining Rare Pizza Box stock (limited; UB said 3 left
 *                       in 2025-09, current number unknown). Required with
 *                       --apply when the item doesn't exist yet.
 *   --apply             create missing items; existing items (matched by
 *                       name) are left as they are and any differences listed.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { ensureTsRuntime, importApp } from "./run-ts.mjs";
import { parseArgs, die, loadDotenv } from "./args.mjs";

ensureTsRuntime(import.meta.url);
loadDotenv(createRequire(import.meta.url));

const args = parseArgs(process.argv.slice(2), { booleans: ["apply", "help"] });
if (args.help) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0]);
  process.exit(0);
}

/** UnbelievaBoat's store (plan §2.3), prices in PEP. */
export const UB_STORE_ITEMS = [
  { name: "Global Pizza Party T-shirt", price: 20240, description: "Official Global Pizza Party tee." },
  { name: "Proof of Pizza", price: 13370, description: "Proof you were there for the pizza." },
  { name: "Rare Pizza Box", price: 42069, description: "A rare PizzaDAO pizza box. Limited stock.", limited: true },
  { name: "Pizza Sticks", price: 1337, description: "Pizza Sticks." },
];

let rareStock = null;
if (args["rare-box-stock"] !== undefined) {
  rareStock = Number(args["rare-box-stock"]);
  if (!Number.isInteger(rareStock) || rareStock < 0) die("--rare-box-stock must be a whole number >= 0");
}
const stockOf = (it) => (it.limited ? rareStock : -1);

console.log("Rows for the Shop tab (Name, Description, Price, Quantity, Image URL); tab-separated, paste into row 2+:\n");
for (const it of UB_STORE_ITEMS) {
  const q = stockOf(it);
  console.log([it.name, it.description, it.price, q === null ? "<remaining stock>" : q, ""].join("\t"));
}
console.log("\nQuantity -1 (or blank) = unlimited. NOTE: every sheet sync sets the DB stock to the sheet's");
console.log("Quantity, so lower the Rare Pizza Box Quantity in the sheet when one sells, or the next sync restocks it.\n");

if (!process.env.DATABASE_URL) {
  console.log("DATABASE_URL not set: printed the sheet rows only.");
  process.exit(0);
}

const { prisma } = await importApp("app/lib/db.ts");
try {
  const existing = new Map((await prisma.shopItem.findMany()).map((i) => [i.name, i]));
  const toCreate = [];
  for (const it of UB_STORE_ITEMS) {
    const cur = existing.get(it.name);
    if (!cur) {
      toCreate.push(it);
      console.log(`  + ${it.name}: create (price ${it.price}, stock ${stockOf(it) ?? "?"})`);
      continue;
    }
    const diffs = [];
    if (cur.price !== it.price) diffs.push(`price ${cur.price} (UB ${it.price})`);
    if (!cur.isAvailable) diffs.push("not available");
    if (it.limited && rareStock !== null && cur.quantity !== rareStock) diffs.push(`stock ${cur.quantity} (given ${rareStock})`);
    console.log(`  = ${it.name}: exists (id ${cur.id})${diffs.length ? "; differs: " + diffs.join(", ") + " (left unchanged)" : ""}`);
  }
  if (!args.apply) {
    console.log("\nDRY RUN - nothing written. Re-run with --apply to create the missing items.");
  } else {
    if (toCreate.some((it) => it.limited) && rareStock === null) die("--rare-box-stock N is required to create the Rare Pizza Box");
    for (const it of toCreate) {
      await prisma.shopItem.create({
        data: { name: it.name, description: it.description, price: it.price, quantity: stockOf(it), isAvailable: true },
      });
    }
    console.log(`\nCreated ${toCreate.length} item(s). Add them to the Shop tab too, or the next sheet sync deactivates them.`);
  }
} finally {
  await prisma.$disconnect();
}
