import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Guard for the prerendered marketing pages. force-static empties cookies()/headers()/searchParams for
// the whole render and the flag is sticky, so it belongs on individual pages, never on the layout.

const ROOT = path.resolve(__dirname, "..");

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" ? [] : pages(p);
    return name === "page.tsx" ? [p] : [];
  });
}

const rel = (p: string) => path.relative(ROOT, p);
const dynamicOf = (src: string) => /^export const dynamic\s*=\s*"([\w-]+)"/m.exec(src)?.[1];
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const readsRequest = (src: string) => /\bsearchParams\b|\bcookies\s*\(|\bheaders\s*\(/.test(stripComments(src));

describe("marketing static pages", () => {
  it("the layout sets neither dynamic nor revalidate", () => {
    const src = readFileSync(path.join(ROOT, "layout.tsx"), "utf8");
    expect(src).not.toMatch(/export\s+const\s+(dynamic|revalidate|fetchCache)\b/);
  });

  const files = pages(ROOT);

  it("finds the marketing pages", () => {
    expect(files.length).toBeGreaterThan(8);
  });

  it.each(files.map((f) => [rel(f), f]))("%s exports dynamic explicitly", (_n, f) => {
    expect(["force-static", "force-dynamic"]).toContain(dynamicOf(readFileSync(f, "utf8")));
  });

  it.each(files.map((f) => [rel(f), f]))("%s does not force-static while reading the request", (_n, f) => {
    const src = readFileSync(f, "utf8");
    if (readsRequest(src)) expect(dynamicOf(src)).toBe("force-dynamic");
  });
});
