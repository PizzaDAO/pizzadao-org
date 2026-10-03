// Module resolve hook that lets plain `node` import the app's TypeScript lib
// modules: extensionless relative imports and the `@/` path alias. Node's
// built-in --experimental-transform-types handles the TypeScript syntax.
//
// Registered by ./run-ts.mjs; scripts never need to load it by hand.
import { existsSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const EXTS = [".ts", ".tsx", ".mts", ".js", ".mjs"];

function tryFile(base) {
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const ext of EXTS) if (existsSync(base + ext)) return base + ext;
  for (const ext of EXTS) {
    const idx = path.join(base, "index" + ext);
    if (existsSync(idx)) return idx;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  let base = null;
  if (specifier.startsWith("@/")) {
    base = path.join(ROOT, specifier.slice(2));
  } else if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    context.parentURL?.startsWith("file:")
  ) {
    base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
  }
  if (base) {
    const hit = tryFile(base);
    if (hit) return nextResolve(pathToFileURL(hit).href, context);
  }
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    // CJS packages without an "exports" map (e.g. `next/cache`) need the
    // explicit .js that bundlers add implicitly.
    if (err?.code === "ERR_MODULE_NOT_FOUND" && !specifier.startsWith(".") && !path.extname(specifier)) {
      return nextResolve(specifier + ".js", context);
    }
    throw err;
  }
}
