// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createGithubClient } from "./github";
import { runLinkChecks, type LinkDb } from "./link-check";

type Route = (url: string) => Response | Promise<Response>;

function mockFetch(routes: Record<string, Route>) {
  const calls: string[] = [];
  const f = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    for (const [prefix, handler] of Object.entries(routes)) if (url.includes(prefix)) return handler(url);
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const repoList = (rows: object[]) => () => new Response(JSON.stringify(rows), { status: 200 });
const R = (name: string, over: object = {}) => ({ name, private: false, default_branch: "main", license: null, pushed_at: null, archived: false, ...over });

function fakeDb(entries: { slug: string; code: unknown; status?: string }[]) {
  const updated: Record<string, { linkCheck: unknown; updatedAt: Date }> = {};
  const at = new Date("2026-01-01T00:00:00Z");
  const db = {
    featureApp: { findMany: async () => [{ repo: "alpha", repoPrivate: false, defaultBranch: "main" }, { repo: "secret", repoPrivate: true, defaultBranch: null }] },
    featureEntry: {
      findMany: async () => entries.map((e) => ({ status: "live", updatedAt: at, ...e })),
      update: async ({ where, data }: { where: { slug: string }; data: { linkCheck: unknown; updatedAt: Date } }) => {
        updated[where.slug] = data;
      },
    },
  } as unknown as LinkDb;
  return { db, updated, at };
}

describe("github client", () => {
  it("lists repos with visibility, branch and license, and caches the result", async () => {
    const { f, calls } = mockFetch({ "/orgs/PizzaDAO/repos": repoList([R("alpha", { license: { spdx_id: "MIT" } }), R("secret", { private: true }), R("odd", { license: { spdx_id: "NOASSERTION" } })]) });
    const c = createGithubClient({ fetchImpl: f, token: null });
    const m = (await c.listRepos())!;
    expect(m.get("alpha")).toMatchObject({ private: false, defaultBranch: "main", license: "MIT" });
    expect(m.get("secret")!.private).toBe(true);
    expect(m.get("odd")!.license).toBeNull();
    await c.listRepos();
    expect(calls).toHaveLength(1);
  });

  it("fails soft: a server error gives null, not an exception", async () => {
    const { f } = mockFetch({ "/orgs/PizzaDAO/repos": () => new Response("boom", { status: 500 }) });
    expect(await createGithubClient({ fetchImpl: f, token: null }).listRepos()).toBeNull();
  });

  it("maps path responses and stops after a rate limit", async () => {
    const limited = () => new Response("limit", { status: 403, headers: { "x-ratelimit-remaining": "0" } });
    const { f, calls } = mockFetch({
      "contents/ok.ts": () => new Response("{}", { status: 200 }),
      "contents/gone.ts": () => new Response("{}", { status: 404 }),
      "contents/limit.ts": limited,
    });
    const c = createGithubClient({ fetchImpl: f, token: "t" });
    expect(await c.checkPath("alpha", "main", "ok.ts")).toBe("ok");
    expect(await c.checkPath("alpha", "main", "gone.ts")).toBe("missing");
    expect(await c.checkPath("alpha", "main", "limit.ts")).toBe("rate_limited");
    const n = calls.length;
    expect(await c.checkPath("alpha", "main", "ok2.ts")).toBe("rate_limited");
    expect(calls).toHaveLength(n);
    expect(c.isRateLimited()).toBe(true);
  });

  it("force bypasses the cache for the repo list and for paths", async () => {
    const { f, calls } = mockFetch({ "/orgs/PizzaDAO/repos": repoList([R("alpha")]), "contents/a.ts": () => new Response("{}", { status: 200 }) });
    const c = createGithubClient({ fetchImpl: f, token: null });
    await c.listRepos();
    await c.checkPath("alpha", "main", "a.ts");
    await c.listRepos();
    await c.checkPath("alpha", "main", "a.ts");
    expect(calls).toHaveLength(2);
    await c.listRepos({ force: true });
    await c.checkPath("alpha", "main", "a.ts", { force: true });
    expect(calls).toHaveLength(4);
  });

  it("sends the token and reads the head commit", async () => {
    let auth = "";
    const sha = "c".repeat(40);
    const f = (async (_u: RequestInfo | URL, init?: RequestInit) => {
      auth = String((init?.headers as Record<string, string>).Authorization);
      return new Response(sha + "\n", { status: 200 });
    }) as unknown as typeof fetch;
    const c = createGithubClient({ fetchImpl: f, token: "tok" });
    expect(await c.headCommit("alpha", "main")).toBe(sha);
    expect(auth).toBe("Bearer tok");
  });
});

describe("runLinkChecks (GitHub mocked)", () => {
  const routes = {
    "/orgs/PizzaDAO/repos": repoList([R("alpha"), R("secret", { private: true })]),
    "contents/src/ok.ts": () => new Response("{}", { status: 200 }),
    "contents/src/moved.ts": () => new Response("{}", { status: 404 }),
  };

  it("flags missing paths, skips private repos without calling GitHub, and keeps updatedAt", async () => {
    const { f, calls } = mockFetch(routes);
    const { db, updated, at } = fakeDb([
      { slug: "good", code: [{ repo: "PizzaDAO/alpha", path: "src/ok.ts" }] },
      { slug: "stale", code: [{ repo: "PizzaDAO/alpha", path: "src/moved.ts" }, { repo: "PizzaDAO/alpha", path: "src/ok.ts" }] },
      { slug: "priv", code: [{ repo: "PizzaDAO/secret", path: "src/x.ts" }, { repo: "PizzaDAO/other", path: "y", private: true }], status: "private" },
      { slug: "gone", code: [{ repo: "PizzaDAO/renamed", path: "src/z.ts" }] },
    ]);
    const s = await runLinkChecks(db, createGithubClient({ fetchImpl: f, token: null }), { concurrency: 1 });
    expect(s).toMatchObject({ checked: 4, broken: 2, skipped: 0, rateLimited: false });
    expect((updated.good.linkCheck as { broken: number }).broken).toBe(0);
    expect((updated.stale.linkCheck as { broken: number }).broken).toBe(1);
    expect((updated.gone.linkCheck as { results: { status: string }[] }).results[0].status).toBe("unlisted");
    expect((updated.priv.linkCheck as { results: { status: string }[] }).results.map((r) => r.status)).toEqual(["private", "private"]);
    expect(updated.good.updatedAt).toBe(at);
    expect(calls.some((u) => u.includes("/repos/PizzaDAO/secret/"))).toBe(false);
    expect(calls.some((u) => u.includes("/repos/PizzaDAO/renamed/"))).toBe(false);
  });

  it("stops cleanly when GitHub rate-limits: unchecked rows are left as they were", async () => {
    const { f } = mockFetch({
      ...routes,
      "contents/src/moved.ts": () => new Response("limit", { status: 429 }),
    });
    const { db, updated } = fakeDb([
      { slug: "a", code: [{ repo: "PizzaDAO/alpha", path: "src/moved.ts" }] },
      { slug: "b", code: [{ repo: "PizzaDAO/alpha", path: "src/ok.ts" }] },
    ]);
    const s = await runLinkChecks(db, createGithubClient({ fetchImpl: f, token: null }), { concurrency: 1 });
    expect(s.rateLimited).toBe(true);
    expect(s.skipped).toBe(2);
    expect(updated).toEqual({});
  });

  it("does nothing when GitHub's repo list is unavailable", async () => {
    const { f } = mockFetch({ "/orgs/PizzaDAO/repos": () => new Response("x", { status: 502 }) });
    const { db, updated } = fakeDb([{ slug: "a", code: [{ repo: "PizzaDAO/alpha", path: "src/ok.ts" }] }]);
    const s = await runLinkChecks(db, createGithubClient({ fetchImpl: f, token: null }));
    expect(s.githubUnavailable).toBe(true);
    expect(updated).toEqual({});
  });
});
