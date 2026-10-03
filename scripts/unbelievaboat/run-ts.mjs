// Shared bootstrap for the UnbelievaBoat scripts.
//
// The migration logic lives in TypeScript under app/lib/unbelievaboat/ so the
// app (login hook) and these scripts share one implementation, and so the
// import credits PEP through the same lib functions/ledger the app uses
// (app/lib/economy.ts + app/lib/transactions.ts).
//
// Node >= 22.18 can run TypeScript, but needs two flags plus a resolve hook
// for extensionless imports and the `@/` alias. `ensureTsRuntime()` re-execs
// the current script with those flags when they are missing, so the scripts
// can be run as plain `node scripts/unbelievaboat/<name>.mjs ...`.
import { spawnSync } from "node:child_process";
import { register } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "../..");
const FLAG = "--experimental-transform-types";

/**
 * Re-exec with TypeScript support if needed. Returns only when the current
 * process can import .ts modules; otherwise exits with the child's status.
 */
export function ensureTsRuntime(scriptUrl) {
  if (process.execArgv.includes(FLAG)) {
    register(new URL("./ts-loader.mjs", import.meta.url));
    return;
  }
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 18)) {
    console.error(`Node >= 22.18 is required (found ${process.versions.node}).`);
    process.exit(1);
  }
  const child = spawnSync(
    process.execPath,
    [FLAG, "--no-warnings", fileURLToPath(scriptUrl), ...process.argv.slice(2)],
    { stdio: "inherit", env: process.env },
  );
  process.exit(child.status ?? 1);
}

/** Import an app module by repo-relative path, e.g. "app/lib/economy.ts". */
export function importApp(rel) {
  return import(path.join(ROOT, rel));
}
