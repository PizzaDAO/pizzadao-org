// Fails when a component calls useTranslations() with a top-level namespace that the root layout
// does not send to the client (see ../client-namespaces.ts).

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import en from "../../../../messages/en.json";
import { CLIENT_NAMESPACES, pickClientMessages } from "../client-namespaces";

const ROOT = path.resolve(__dirname, "../../../..");
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "__tests__", "messages"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
}

describe("client message namespaces", () => {
  const files = ["app", "components", "lib", "hooks", "utils"]
    .map((d) => path.join(ROOT, d))
    .filter((d) => fs.existsSync(d))
    .flatMap((d) => walk(d));

  it("covers every namespace used by useTranslations()", () => {
    const problems: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      if (!src.includes("useTranslations") && !src.includes("useMessages")) continue;
      const rel = path.relative(ROOT, f);
      if (rel === path.join("app", "lib", "i18n", "client-namespaces.ts")) continue;
      if (/useTranslations\s+as\s+\w+/.test(src)) problems.push(`${rel}: aliased useTranslations import cannot be checked`);
      if (/useMessages\(/.test(src)) problems.push(`${rel}: useMessages() needs the whole catalog`);
      for (const m of src.matchAll(/useTranslations\s*(?:<[^>]*>)?\(\s*([^)]*)\)/g)) {
        const arg = m[1].trim();
        const lit = /^(["'`])([A-Za-z0-9_.]+)\1$/.exec(arg);
        if (!lit) {
          problems.push(`${rel}: useTranslations(${arg}) is not a string literal`);
          continue;
        }
        const top = lit[2].split(".")[0];
        if (!(CLIENT_NAMESPACES as readonly string[]).includes(top)) {
          problems.push(`${rel}: "${top}" is not in CLIENT_NAMESPACES`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("only lists namespaces that exist, and picks them", () => {
    const picked = pickClientMessages(en as Record<string, unknown>);
    for (const ns of CLIENT_NAMESPACES) {
      if (ns === "disavow") continue; // added by the disavow layout, not in the root catalog
      expect(Object.keys(en)).toContain(ns);
      expect(picked).toHaveProperty(ns);
    }
    expect(Object.keys(picked).length).toBeLessThan(Object.keys(en).length);
  });
});
