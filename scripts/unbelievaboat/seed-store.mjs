#!/usr/bin/env node
/**
 * Recreate UnbelievaBoat's store items in the $PEP shop, and create retired
 * UB items as collectibles. DRY RUN BY DEFAULT.
 *
 * Carried over (owner decision): Rare Pizza Box, Proof of Pizza, Pizza Sticks
 * (the current UB store) and the retired Molto Benny Pin as a COLLECTIBLE
 * (held and shown in inventories, never for sale). "Chicken" is NOT carried
 * over (grant-items.mjs skips it).
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
 *   DATABASE_URL=... node scripts/unbelievaboat/seed-store.mjs --collectible "Molto Benny Pin" [--apply]
 *
 *   --rare-box-stock N  remaining Rare Pizza Box stock (limited; UB said 3 left
 *                       in 2025-09, current number unknown). Required with
 *                       --apply when the item doesn't exist yet.
 *   --apply             create missing items; existing items (matched by
 *                       name) are left as they are and any differences listed.
 *   --collectible NAME  instead of the store items, create NAME as a
 *                       collectible (ShopItem.isCollectible, not for sale,
 *                       price 0, isAvailable false). Known collectibles have a
 *                       built-in description and icon; for any other name pass
 *                       --description "..." (and optionally --image URL).
 *                       Collectibles live in the DB only: do NOT add them to
 *                       the Shop tab (the sync ignores a sheet row with a
 *                       collectible's name, and never deactivates one). An
 *                       existing regular item with that name is converted to a
 *                       collectible on --apply.
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

/** UnbelievaBoat's current store (plan §2.3), prices in PEP. */
export const UB_STORE_ITEMS = [
  { name: "Proof of Pizza", price: 13370, description: "Proof you were there for the pizza." },
  { name: "Rare Pizza Box", price: 42069, description: "A rare PizzaDAO pizza box. Limited stock.", limited: true },
  { name: "Pizza Sticks", price: 1337, description: "Pizza Sticks." },
];

/** Retired UB items carried over as collectibles (never for sale). */
export const UB_COLLECTIBLES = {
  "Molto Benny Pin": {
    description: "📌 Retired UnbelievaBoat collectible: the Molto Benny pin. Not for sale.",
    image: "https://app.pizzadao.org/brand-kit/molto-benny/molto-benny-color.png",
  },
};

if (args.collectible !== undefined) {
  await seedCollectible();
  process.exit(0);
}

async function seedCollectible() {
  const name = typeof args.collectible === "string" ? args.collectible.trim() : "";
  if (!name) die('--collectible needs a name, e.g. --collectible "Molto Benny Pin"');
  const known = UB_COLLECTIBLES[name] ?? {};
  const description = typeof args.description === "string" ? args.description : known.description;
  const image = typeof args.image === "string" ? args.image : (known.image ?? null);
  if (!description) die(`no built-in description for "${name}": pass --description "..."`);
  const data = { name, description, image, price: 0, quantity: 0, isAvailable: false, isCollectible: true };
  console.log(`Collectible "${name}" (not for sale; keep it OUT of the Shop tab):`);
  console.log(`  description: ${description}`);
  console.log(`  image:       ${image ?? "(none)"}`);
  if (!process.env.DATABASE_URL) {
    console.log("\nDATABASE_URL not set: printed the collectible only.");
    return;
  }
  const { prisma } = await importApp("app/lib/db.ts");
  try {
    const cur = await prisma.shopItem.findUnique({ where: { name } });
    if (cur?.isCollectible) {
      console.log(`  = exists as a collectible (id ${cur.id}); nothing to do.`);
      return;
    }
    console.log(cur ? `  ~ exists as a regular shop item (id ${cur.id}): convert to a collectible` : "  + create");
    if (!args.apply) {
      console.log("\nDRY RUN - nothing written. Re-run with --apply.");
      return;
    }
    const row = cur
      ? await prisma.shopItem.update({ where: { id: cur.id }, data: { isCollectible: true, isAvailable: false, description, image } })
      : await prisma.shopItem.create({ data });
    console.log(`\n${cur ? "Converted" : "Created"} collectible "${row.name}" (id ${row.id}).`);
  } finally {
    await prisma.$disconnect();
  }
}

let rareStock = null;
if (args["rare-box-stock"] !== undefined) {
  rareStock = Number(args["rare-box-stock"]);
  if (!Number.isInteger(rareStock) || rareStock < 0) die("--rare-box-stock must be a whole number >= 0");
}
const stockOf = (it) => (it.limited ? rareStock : -1);

console.log("Rows for the Shop tab (Name, Description, Price, Quantity, Image URL); tab-separated; append them below the existing rows:\n");
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
