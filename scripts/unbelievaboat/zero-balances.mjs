#!/usr/bin/env node
/**
 * Cutover step: set every migrated user's UnbelievaBoat cash and bank to 0 so
 * balances cannot be spent twice (once in UB, once as PEP). DRY RUN BY DEFAULT.
 * Requires the UB API token (the public-leaderboard path cannot write).
 *
 * Run only AFTER import.mjs --apply has verified. For each user in the
 * snapshot with a non-zero balance it re-reads the live UB balance and skips
 * anyone whose balance changed since the snapshot (UB was not frozen), so
 * nothing earned after the export is silently wiped.
 *
 * Usage:
 *   UNBELIEVABOAT_API_TOKEN=... DISCORD_GUILD_ID=... \
 *     node scripts/unbelievaboat/zero-balances.mjs --snapshot <ub-...json> [--apply --confirm-count N]
 *
 * Each PUT carries an audit-log reason naming the snapshot sha256.
 */
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ensureTsRuntime, importApp } from "./run-ts.mjs";
import { parseArgs, die, loadDotenv } from "./args.mjs";

ensureTsRuntime(import.meta.url);
loadDotenv(createRequire(import.meta.url));

const args = parseArgs(process.argv.slice(2), { booleans: ["apply", "help"] });
if (args.help || !args.snapshot) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0]);
  process.exit(args.help ? 0 : 1);
}

const { createUbClient, UB_API_BASE } = await importApp("app/lib/unbelievaboat/ub-api.ts");
const snap = await importApp("app/lib/unbelievaboat/snapshot.ts");

const snapshotPath = path.resolve(args.snapshot);
const jsonText = readFileSync(snapshotPath, "utf8");
const snapshot = snap.validateSnapshot(JSON.parse(jsonText));
const stem = snapshotPath.replace(/\.json$/, "");
const manifestPath = `${stem}.manifest.json`;
if (!existsSync(manifestPath)) die("snapshot manifest missing");
const v = snap.verifyManifest(
  JSON.parse(readFileSync(manifestPath, "utf8")),
  jsonText,
  existsSync(`${stem}.csv`) ? readFileSync(`${stem}.csv`, "utf8") : null,
  process.env.UB_SNAPSHOT_SIGNING_KEY || null,
);
if (!v.ok) die(`snapshot does not verify: ${v.errors.join("; ")}`);

const guildId = (process.env.DISCORD_GUILD_ID || "").trim();
if (guildId !== snapshot.guildId) die(`DISCORD_GUILD_ID (${guildId || "unset"}) does not match the snapshot guild ${snapshot.guildId}`);
const token = (process.env.UNBELIEVABOAT_API_TOKEN || "").trim();
if (!token) die("UNBELIEVABOAT_API_TOKEN is required to write to UnbelievaBoat");

const sha = snap.sha256Hex(jsonText);
const reason = `Migrated to $PEP at app.pizzadao.org (snapshot ${sha.slice(0, 12)})`;
const targets = snapshot.users.filter((u) => snap.isFiniteAmount(u.cash) && snap.isFiniteAmount(u.bank) && (u.cash !== "0" || u.bank !== "0"));
const skippedNonFinite = snapshot.users.filter((u) => !snap.isFiniteAmount(u.cash) || !snap.isFiniteAmount(u.bank));

console.log(`Snapshot ${path.basename(snapshotPath)} (${snapshot.users.length} users), sha256 ${sha}`);
console.log(`  to zero: ${targets.length} users with a non-zero balance`);
if (skippedNonFinite.length) console.log(`  not touched (non-finite, handle by hand): ${skippedNonFinite.map((u) => u.discordId).join(", ")}`);
console.log(`  audit reason: "${reason}"`);

if (!args.apply) {
  console.log(`\nDRY RUN - UnbelievaBoat was not changed. To apply: --apply --confirm-count ${targets.length}`);
  process.exit(0);
}
if (String(args["confirm-count"]) !== String(targets.length)) die(`--confirm-count must be ${targets.length}`);

const ub = createUbClient({ token, baseUrl: (process.env.UNBELIEVABOAT_API_BASE || UB_API_BASE).trim(), log: (m) => console.error(`  ${m}`) });
const results = [];
for (const u of targets) {
  const live = await ub.request(`/guilds/${guildId}/users/${u.discordId}`);
  const liveCash = snap.normalizeAmount(live.cash);
  const liveBank = snap.normalizeAmount(live.bank);
  if (liveCash !== u.cash || liveBank !== u.bank) {
    results.push({ discordId: u.discordId, status: "changed-since-snapshot", snapshot: { cash: u.cash, bank: u.bank }, live: { cash: liveCash, bank: liveBank } });
    continue;
  }
  await ub.setBalance(guildId, u.discordId, { cash: 0, bank: 0, reason });
  results.push({ discordId: u.discordId, status: "zeroed", was: { cash: u.cash, bank: u.bank } });
}

const outPath = `${stem}.zeroed-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(outPath, JSON.stringify({ snapshotSha: sha, reason, results }, null, 2) + "\n");
const changed = results.filter((r) => r.status !== "zeroed");
console.log(`\nZeroed ${results.length - changed.length}/${targets.length}. Changed since snapshot (left alone): ${changed.length}`);
for (const c of changed) console.log(`  ${c.discordId}: snapshot ${c.snapshot.cash}/${c.snapshot.bank}, live ${c.live.cash}/${c.live.bank}`);
console.log(`Log: ${outPath}`);
process.exit(changed.length ? 2 : 0);
