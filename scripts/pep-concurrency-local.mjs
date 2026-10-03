#!/usr/bin/env node
// scripts/pep-concurrency-local.mjs — `npm run test:pep-concurrency`
//
// Runs the real-Postgres $PEP concurrency suite
// (app/lib/pep-economy.concurrency.test.ts) against a throwaway local Postgres:
//   1. starts postgres:17 in docker on 127.0.0.1:$PEP_IT_PG_PORT (tmpfs, --rm),
//      or uses PEP_IT_DATABASE_URL if it points at localhost
//   2. creates the schema with `prisma db push` (same as e2e:local)
//   3. runs the vitest file with PEP_IT_DATABASE_URL set
//
// It never touches production: the URL must be localhost, and the app's Neon
// adapter is routed to the local socket by e2e/local/preload.cjs's WebSocket shim.
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONTAINER = "pizzadao-pep-it-pg";
const PG_PORT = process.env.PEP_IT_PG_PORT || "54331";

function die(msg) {
  console.error(`[pep-it] ERROR: ${msg}`);
  process.exit(1);
}
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", ...opts });
  if (r.status !== 0) die(`${cmd} ${args.join(" ")} failed (exit ${r.status})`);
  return r;
}

let databaseUrl = process.env.PEP_IT_DATABASE_URL;
let started = false;
if (databaseUrl) {
  if (!["localhost", "127.0.0.1"].includes(new URL(databaseUrl).hostname)) die("PEP_IT_DATABASE_URL must point at localhost");
} else {
  if (spawnSync("docker", ["info"], { stdio: "ignore" }).status !== 0) die("docker is not available (or set PEP_IT_DATABASE_URL)");
  spawnSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
  run("docker", [
    "run", "-d", "--rm", "--name", CONTAINER,
    "-e", "POSTGRES_USER=pep", "-e", "POSTGRES_PASSWORD=pep", "-e", "POSTGRES_DB=pep_it",
    "-e", "POSTGRES_HOST_AUTH_METHOD=password",
    "-p", `127.0.0.1:${PG_PORT}:5432`,
    "--tmpfs", "/var/lib/postgresql/data",
    "postgres:17", "-c", "max_connections=200",
  ], { stdio: ["ignore", "ignore", "inherit"] });
  started = true;
  databaseUrl = `postgresql://pep:pep@localhost:${PG_PORT}/pep_it`;
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    ready = spawnSync("docker", ["exec", CONTAINER, "pg_isready", "-U", "pep", "-h", "127.0.0.1"], { stdio: "ignore" }).status === 0;
    if (!ready) spawnSync("sleep", ["1"]);
  }
  if (!ready) die("Postgres did not become ready");
}
const cleanup = () => {
  if (started && !process.env.PEP_IT_KEEP_DB) spawnSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
  started = false;
};
process.on("exit", cleanup);

const env = { ...process.env, DATABASE_URL: databaseUrl, PEP_IT_DATABASE_URL: databaseUrl, NODE_OPTIONS: "" };
run("npx", ["prisma", "db", "push", "--accept-data-loss"], { env });
const r = spawnSync("npx", ["vitest", "run", "app/lib/pep-economy.concurrency.test.ts", ...process.argv.slice(2)], { cwd: ROOT, stdio: "inherit", env });
cleanup();
process.exit(r.status ?? 1);
