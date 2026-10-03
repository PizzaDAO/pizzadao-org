#!/usr/bin/env node
/**
 * Register the $PEP slash commands (app/lib/discord-interactions/commands.ts)
 * as GUILD commands of the PizzaDAO Discord application. DRY RUN BY DEFAULT.
 *
 * Commands: /balance /work /collect-income /pay /leaderboard /blackjack
 * /roulette /slots /shop /buy /add-money /remove-money /missions. The games
 * answer "not enabled yet" until PEP_GAMES_ENABLED=1 (Vercel env), so
 * registering them all up front is safe. /missions only shows progress (a dry
 * run) until MISSION_VERIFIERS_ENABLED=1.
 *
 * Usage:
 *   DISCORD_APPLICATION_ID=... DISCORD_BOT_TOKEN=... DISCORD_GUILD_ID=... \
 *     node scripts/discord/register-commands.mjs [--apply]
 *
 * --apply does PUT /applications/{app}/guilds/{guild}/commands, which
 * REPLACES this application's guild commands with exactly this list (guild
 * commands update instantly; global ones can take up to an hour). It does
 * not touch UnbelievaBoat's commands, which belong to UB's application.
 *
 * Before --apply: set the application's Interactions Endpoint URL to
 * https://app.pizzadao.org/api/discord/interactions and DISCORD_PUBLIC_KEY in
 * Vercel. Note an application with an Interactions Endpoint URL receives
 * interactions over HTTP only, not over a gateway connection.
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

const { PEP_COMMANDS } = await importApp("app/lib/discord-interactions/commands.ts");
const appId = (process.env.DISCORD_APPLICATION_ID || "").trim();
const guildId = (process.env.DISCORD_GUILD_ID || "").trim();
const url = `${(process.env.DISCORD_API_BASE || "https://discord.com/api/v10").trim()}/applications/${appId || "<DISCORD_APPLICATION_ID>"}/guilds/${guildId || "<DISCORD_GUILD_ID>"}/commands`;

console.log(`PUT ${url}`);
console.log(JSON.stringify(PEP_COMMANDS, null, 2));

if (!args.apply) {
  console.log("\nDRY RUN - nothing was registered. Re-run with --apply.");
  process.exit(0);
}
if (!/^\d+$/.test(appId) || !/^\d+$/.test(guildId)) die("DISCORD_APPLICATION_ID and DISCORD_GUILD_ID must be set");
const botToken = (process.env.DISCORD_BOT_TOKEN || "").trim();
if (!botToken) die("DISCORD_BOT_TOKEN must be set");

const res = await fetch(url, {
  method: "PUT",
  headers: { Authorization: `Bot ${botToken}`, "Content-Type": "application/json" },
  body: JSON.stringify(PEP_COMMANDS),
});
const text = await res.text();
if (!res.ok) die(`Discord ${res.status}: ${text}`);
const registered = JSON.parse(text);
console.log(`\nRegistered ${registered.length} commands: ${registered.map((c) => "/" + c.name).join(", ")}`);
