#!/usr/bin/env node
/**
 * Export every UnbelievaBoat balance in the PizzaDAO guild to a timestamped,
 * checksummed snapshot. Read-only against UnbelievaBoat (GET requests only).
 *
 * Usage:
 *   UNBELIEVABOAT_API_TOKEN=... DISCORD_GUILD_ID=812097286003359764 \
 *     node scripts/unbelievaboat/export.mjs [options]
 *
 * Options:
 *   --out <dir>          Output directory (default scripts/unbelievaboat/snapshots)
 *   --page-size <n>      Leaderboard page size (default 1000, the API default)
 *   --store              Also export store items (needs the token's "items" permission)
 *   --inventory          Also export every user's inventory (1+ request per user)
 *   --resolve-discord    Annotate users with bot / still-in-server / username via
 *                        DISCORD_BOT_TOKEN (1-2 Discord requests per user)
 *   --public             No token: read the public web leaderboard JSON instead
 *                        (unofficial, needs the leaderboard to be public, balances
 *                        only: no inventories/store, and UB cannot be zeroed later)
 *   --from-csv <file>    Build the snapshot from a CSV (discord_id/user_id, cash, bank)
 *                        instead of calling the API, e.g. a manual dashboard export
 *
 * Env:
 *   UNBELIEVABOAT_API_TOKEN   token from https://unbelievaboat.com/applications
 *   DISCORD_GUILD_ID          PizzaDAO guild id
 *   UB_SNAPSHOT_SIGNING_KEY   optional; HMAC-signs the manifest (keep it offline)
 *   UNBELIEVABOAT_API_BASE    optional override (tests point this at a mock server)
 *   UNBELIEVABOAT_PUBLIC_BASE optional override for --public
 *
 * Writes <out>/ub-<guild>-<timestamp>.{json,csv,manifest.json}.
 */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ensureTsRuntime, importApp, ROOT } from "./run-ts.mjs";
import { parseArgs, die, loadDotenv } from "./args.mjs";

ensureTsRuntime(import.meta.url);
loadDotenv(createRequire(import.meta.url));

const args = parseArgs(process.argv.slice(2), {
  booleans: ["store", "inventory", "resolve-discord", "public", "help"],
});
if (args.help) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0]);
  process.exit(0);
}

const { createUbClient, createPublicUbClient, UB_API_BASE, UB_PUBLIC_BASE } = await importApp("app/lib/unbelievaboat/ub-api.ts");
const snap = await importApp("app/lib/unbelievaboat/snapshot.ts");
const { createDiscordLookup } = await importApp("app/lib/unbelievaboat/discord-lookup.ts");

const guildId = (process.env.DISCORD_GUILD_ID || "").trim();
if (!/^\d{5,25}$/.test(guildId)) die("DISCORD_GUILD_ID must be set to the guild's numeric id");

const outDir = path.resolve(args.out || path.join(ROOT, "scripts/unbelievaboat/snapshots"));
const pageSize = Number(args["page-size"] || 1000);
const apiBase = (process.env.UNBELIEVABOAT_API_BASE || UB_API_BASE).trim();
const log = (m) => console.error(`  ${m}`);

let snapshot;
if (args["from-csv"]) {
  const text = readFileSync(path.resolve(args["from-csv"]), "utf8");
  snapshot = snap.snapshotFromCsv(text, { guildId });
  console.error(`Built snapshot from CSV ${args["from-csv"]}: ${snapshot.users.length} users`);
} else if (args.public) {
  if (args.store || args.inventory) die("--store/--inventory need the token API; the public leaderboard has balances only");
  const publicBase = (process.env.UNBELIEVABOAT_PUBLIC_BASE || UB_PUBLIC_BASE).trim();
  console.error(`Exporting PUBLIC leaderboard for guild ${guildId} from ${publicBase} (no token) ...`);
  const pub = createPublicUbClient({ baseUrl: publicBase, log });
  let res;
  try {
    res = await pub.getAllUsers(guildId);
  } catch (err) {
    if (err?.status === 401 || err?.status === 403) die("the guild leaderboard is not public; use a UB API token instead");
    throw err;
  }
  if (res.duplicates) log(`warning: ${res.duplicates} users appeared on two pages (is UB frozen?)`);
  snapshot = snap.buildSnapshot({ guildId, users: res.users, pages: res.pages, apiBase: publicBase, discord: res.discord });
  console.error(`Public leaderboard requests made: ${pub.requestCount}`);
} else {
  const token = (process.env.UNBELIEVABOAT_API_TOKEN || "").trim();
  if (!token) die("UNBELIEVABOAT_API_TOKEN is not set (create one at https://unbelievaboat.com/applications), or pass --public");
  const ub = createUbClient({ token, baseUrl: apiBase, log });

  try {
    const perm = await ub.getPermissions(guildId);
    const bits = Number(perm?.permissions ?? 0);
    console.error(`UB application permissions for guild: ${bits} (economy=${!!(bits & 1)}, items=${!!(bits & 2)})`);
    if (!(bits & 1)) die("the UB application is not authorized for economy in this guild (grant it in the UB dashboard)");
    // The docs only name bit 1 (economy); the example value 3 implies a second
    // (items) bit. Warn rather than fail: the item calls will 403 if missing.
    if ((args.store || args.inventory) && !(bits & 2)) log("warning: items permission bit (2) not set; item calls may fail");
  } catch (err) {
    if (err?.status === 401 || err?.status === 403) die(`UB rejected the token: ${err.message}`);
    log(`permission check skipped: ${err.message}`);
  }

  console.error(`Exporting leaderboard for guild ${guildId} from ${apiBase} ...`);
  const { users, pages, duplicates } = await ub.getAllUsers(guildId, pageSize);
  if (duplicates) log(`warning: ${duplicates} users appeared on two pages (balances moved during export; is UB frozen?)`);

  let storeItems;
  if (args.store) {
    storeItems = await ub.getStoreItems(guildId);
    console.error(`Store items: ${storeItems.length}`);
  }

  let inventories;
  if (args.inventory) {
    inventories = new Map();
    let i = 0;
    for (const u of users) {
      inventories.set(u.user_id, await ub.getInventory(guildId, u.user_id));
      if (++i % 50 === 0) log(`inventories ${i}/${users.length}`);
    }
    const holders = [...inventories.values()].filter((x) => x.length).length;
    console.error(`Inventories fetched: ${users.length} users, ${holders} hold items`);
  }

  let discord;
  if (args["resolve-discord"]) {
    const botToken = (process.env.DISCORD_BOT_TOKEN || "").trim();
    if (!botToken) die("--resolve-discord needs DISCORD_BOT_TOKEN");
    const dl = createDiscordLookup({ botToken, guildId, log });
    discord = await dl.lookupAll(
      users.map((u) => u.user_id),
      (d, t) => d % 100 === 0 && log(`discord lookups ${d}/${t}`),
    );
  }

  snapshot = snap.buildSnapshot({ guildId, users, pages, apiBase, storeItems, inventories, discord });
  console.error(`UB API requests made: ${ub.requestCount}`);
}

const json = snap.snapshotToJson(snapshot);
const csv = snap.snapshotToCsv(snapshot);
const manifest = snap.buildManifest(snapshot, json, csv, process.env.UB_SNAPSHOT_SIGNING_KEY || null);

mkdirSync(outDir, { recursive: true });
const stamp = snapshot.exportedAt.replace(/[:.]/g, "-");
const base = path.join(outDir, `ub-${guildId}-${stamp}`);
writeFileSync(`${base}.json`, json);
writeFileSync(`${base}.csv`, csv);
writeFileSync(`${base}.manifest.json`, JSON.stringify(manifest, null, 2) + "\n");

const t = snapshot.totals;
console.log(
  [
    "",
    `Snapshot written:`,
    `  ${base}.json`,
    `  ${base}.csv`,
    `  ${base}.manifest.json`,
    "",
    `  users ${t.users}   cash ${t.cash}   bank ${t.bank}   total ${t.total}`,
    `  json sha256 ${manifest.jsonSha256}`,
    `  csv  sha256 ${manifest.csvSha256}`,
    `  signed: ${manifest.hmacSha256 ? "yes (HMAC-SHA256)" : "no (set UB_SNAPSHOT_SIGNING_KEY to sign)"}`,
    "",
    `Next: node scripts/unbelievaboat/import.mjs --snapshot ${base}.json --members <crew.csv>`,
  ].join("\n"),
);
