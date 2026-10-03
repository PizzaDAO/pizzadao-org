// Tiny argv parser shared by the UnbelievaBoat scripts.
//   --flag            -> { flag: true }
//   --key value       -> { key: "value" }
//   --key=value       -> { key: "value" }
export function parseArgs(argv, { booleans = [] } = {}) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      out._.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    if (eq > 0) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (booleans.includes(key) || next === undefined || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

export function die(msg, code = 1) {
  console.error(`\nError: ${msg}`);
  process.exit(code);
}

/** Load .env.local / .env (if present) without overriding the real environment. */
export function loadDotenv(require) {
  try {
    const dotenv = require("dotenv");
    dotenv.config({ path: ".env.local", quiet: true });
    dotenv.config({ path: ".env", quiet: true });
  } catch {
    /* dotenv optional */
  }
}
