// Guard for per-route client messages (see ../route-namespaces.ts).
//
// A client component that calls useTranslations("ns") renders raw keys if its route's
// NextIntlClientProvider does not carry "ns". This test statically walks the import graph from every
// route entry (page/layout/template/error/not-found/loading) and fails when:
//   - a namespace used in a route's closure is not supplied by ROOT_NAMESPACES + that route's list
//   - a list entry is no longer needed (stale entries only bloat the payload)
//   - a namespace cannot be determined statically (variable argument, alias, useMessages, bare call,
//     non-literal import()): flagged rather than silently passed
//   - a segment's layout does not render <RouteMessages route="...">

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import en from "../../../../messages/en.json";
import {
  OWN_CATALOG_SEGMENTS,
  pickMessages,
  ROOT_NAMESPACES,
  ROUTE_NAMESPACES,
  routeMessagePaths,
} from "../route-namespaces";

const ROOT = path.resolve(__dirname, "../../../..");
const APP = path.join(ROOT, "app");
const ENTRY_RE = /^(page|layout|template|error|global-error|not-found|loading|default)\.(tsx|ts|jsx|js)$/;
const SKIP_DIRS = new Set(["node_modules", ".next", "__tests__", "lib", "ui", "api", "fonts"]);
const EXTS = [".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts", "/index.jsx", "/index.js"];

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return /\.(tsx?|jsx?)$/.test(base) ? base : null;
  for (const e of EXTS) if (fs.existsSync(base + e)) return base + e;
  return null;
}

type FileInfo = { imports: string[]; uses: string[]; problems: string[] };
const cache = new Map<string, FileInfo>();

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

function info(file: string): FileInfo {
  const hit = cache.get(file);
  if (hit) return hit;
  const rel = path.relative(ROOT, file);
  const src = stripComments(fs.readFileSync(file, "utf8"));
  const imports: string[] = [];
  const problems: string[] = [];
  const spec = /(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|^\s*import\s*["']([^"']+)["']/gm;
  for (const m of src.matchAll(spec)) {
    const r = resolveImport(file, m[1] ?? m[2] ?? m[3]);
    if (r) imports.push(r);
  }
  for (const m of src.matchAll(/\bimport\(\s*(.{0,80})/g)) {
    // A literal specifier is a plain quoted string (parentheses allowed, as in route-group paths).
    if (/^(["'])[^"'`$]*\1\s*\)/.test(m[1])) continue;
    // Only matters if it could load a component; catalog loaders carry no useTranslations calls.
    if (!/\.json|\bmessages\b/.test(m[1])) problems.push(`${rel}: non-literal import(${m[1].trim()}) cannot be followed`);
  }
  const uses: string[] = [];
  if (/\buseTranslations\b/.test(src)) {
    if (/useTranslations\s+as\s+\w+/.test(src)) problems.push(`${rel}: aliased useTranslations import cannot be checked`);
    for (const m of src.matchAll(/\buseTranslations\s*(?:<[^>()]*>)?\(\s*([^)]*)\)/g)) {
      const arg = m[1].trim();
      const lit = /^(["'`])([A-Za-z0-9_.]+)\1$/.exec(arg);
      if (lit) uses.push(lit[2]);
      else if (arg === "") problems.push(`${rel}: useTranslations() with no namespace needs the whole catalog`);
      else problems.push(`${rel}: useTranslations(${arg}) is not a string literal`);
    }
  }
  if (/\buseMessages\s*\(/.test(src)) problems.push(`${rel}: useMessages() needs the whole catalog`);
  const v = { imports, uses, problems };
  cache.set(file, v);
  return v;
}

type Closure = { uses: Map<string, string[]>; problems: Set<string> };
function closure(entries: string[]): Closure {
  const seen = new Set<string>();
  const uses = new Map<string, string[]>();
  const problems = new Set<string>();
  const stack = [...entries];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    const i = info(f);
    for (const u of i.uses) uses.set(u, [...(uses.get(u) ?? []), path.relative(ROOT, f)]);
    i.problems.forEach((p) => problems.add(p));
    stack.push(...i.imports);
  }
  return { uses, problems };
}

function entriesIn(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) entriesIn(p, out);
    else if (ENTRY_RE.test(e.name)) out.push(p);
  }
  return out;
}

/** True when a supplied catalog path covers a used namespace: equal, or an ancestor of the use. */
const covers = (supplied: string, use: string) => use === supplied || use.startsWith(`${supplied}.`);
const coveredBy = (supplied: readonly string[], use: string) => supplied.some((s) => covers(s, use));

// Top-level segments under app/ that contain route entries, plus "" for app/page.tsx.
const segments = new Map<string, string[]>();
const rootChrome: string[] = [path.join(APP, "layout.tsx")];
const rootOther: string[] = [];
for (const e of fs.readdirSync(APP, { withFileTypes: true })) {
  const p = path.join(APP, e.name);
  if (e.isDirectory()) {
    if (SKIP_DIRS.has(e.name)) continue;
    const entries = entriesIn(p);
    if (entries.length) segments.set(e.name, entries);
  } else if (ENTRY_RE.test(e.name)) {
    if (p === rootChrome[0]) continue;
    if (/^page\./.test(e.name)) segments.set("", [p]);
    else rootOther.push(p);
  }
}

describe("per-route client messages", () => {
  it("every route's provider supplies the namespaces its client components use", () => {
    const problems: string[] = [];
    for (const [seg, entries] of segments) {
      const c = closure(entries);
      c.problems.forEach((p) => problems.push(`[${seg || "app/page"}] ${p}`));
      const supplied = [...routeMessagePaths(seg), ...(OWN_CATALOG_SEGMENTS[seg] ?? [])];
      for (const [use, files] of c.uses) {
        if (!coveredBy(supplied, use)) {
          problems.push(`[${seg || "app/page"}] "${use}" (in ${files.join(", ")}) is not supplied: add it to ROUTE_NAMESPACES["${seg}"]`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("the root layout (and root error/not-found/loading) only needs ROOT_NAMESPACES", () => {
    const c = closure([...rootChrome, ...rootOther]);
    const problems = [...c.problems];
    for (const [use, files] of c.uses) {
      if (!coveredBy(ROOT_NAMESPACES, use)) problems.push(`"${use}" (in ${files.join(", ")}) is not in ROOT_NAMESPACES`);
    }
    expect(problems).toEqual([]);
  });

  it("lists no stale ROOT_NAMESPACES entries", () => {
    const c = closure(rootChrome);
    const stale = ROOT_NAMESPACES.filter((n) => ![...c.uses.keys()].some((u) => covers(n, u)));
    expect(stale).toEqual([]);
  });

  it("lists no stale ROUTE_NAMESPACES entries", () => {
    const stale: string[] = [];
    for (const [seg, list] of Object.entries(ROUTE_NAMESPACES)) {
      const entries = segments.get(seg);
      if (!entries) {
        stale.push(`${seg}: no route entries under app/${seg}`);
        continue;
      }
      const needed = [...closure(entries).uses.keys()].filter((u) => !coveredBy(ROOT_NAMESPACES, u));
      for (const n of list) if (!needed.some((u) => covers(n, u))) stale.push(`${seg}: "${n}" is not used by any client component on the route`);
      if (new Set(list).size !== list.length) stale.push(`${seg}: duplicate entries`);
    }
    for (const [seg, list] of Object.entries(OWN_CATALOG_SEGMENTS)) {
      const used = [...closure(segments.get(seg) ?? []).uses.keys()];
      for (const n of list) if (!used.some((u) => covers(n, u))) stale.push(`${seg}: own catalog "${n}" is not used`);
    }
    expect(stale).toEqual([]);
  });

  it("each listed segment's layout renders <RouteMessages> with its own key", () => {
    const problems: string[] = [];
    for (const seg of Object.keys(ROUTE_NAMESPACES)) {
      const file = seg === "" ? path.join(APP, "page.tsx") : path.join(APP, seg, "layout.tsx");
      const src = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
      if (!src.includes(`<RouteMessages route="${seg}"`)) problems.push(`${path.relative(ROOT, file)} must render <RouteMessages route="${seg}">`);
    }
    // And nowhere else: a RouteMessages with an unknown or mismatched key would send the wrong subset.
    for (const f of [...segments.values()].flat()) {
      const src = fs.readFileSync(f, "utf8");
      for (const m of src.matchAll(/<RouteMessages\s+route="([^"]*)"/g)) {
        const rel = path.relative(APP, f).split(path.sep);
        const seg = rel.length === 1 ? "" : rel[0];
        if (m[1] !== seg || !(m[1] in ROUTE_NAMESPACES)) problems.push(`${path.relative(ROOT, f)}: route="${m[1]}" does not match its segment "${seg}" or ROUTE_NAMESPACES`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("only lists catalog paths that exist, and picks them", () => {
    const all = new Set<string>([...ROOT_NAMESPACES, ...Object.values(ROUTE_NAMESPACES).flat()]);
    const missing = [...all].filter((p) => Object.keys(pickMessages(en as Record<string, unknown>, [p])).length === 0);
    expect(missing).toEqual([]);
    const picked = pickMessages(en as Record<string, unknown>, ["proposals.banner", "nav"]);
    expect(Object.keys(picked).sort()).toEqual(["nav", "proposals"]);
    expect(Object.keys(picked.proposals as object)).toEqual(["banner"]);
  });

  it("pickMessages lets a whole namespace win over a deeper path inside it", () => {
    const picked = pickMessages(en as Record<string, unknown>, ["proposals.banner", "proposals"]);
    expect(picked.proposals).toBe((en as Record<string, unknown>).proposals);
  });

  it("the root payload is much smaller than the full catalog", () => {
    const full = JSON.stringify(en).length;
    const root = JSON.stringify(pickMessages(en as Record<string, unknown>, ROOT_NAMESPACES)).length;
    expect(root).toBeLessThan(full / 10);
  });
});
