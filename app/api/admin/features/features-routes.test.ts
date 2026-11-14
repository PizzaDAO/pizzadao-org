// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  prisma: {
    featureApp: { findMany: vi.fn(async () => []), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    featureEntry: { findMany: vi.fn(async () => []), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  },
  runLinkChecks: vi.fn(async () => ({ checked: 0, broken: 0, skipped: 0, rateLimited: false, githubUnavailable: false })),
  importSeed: vi.fn(async () => ({})),
  switches: { exportEnabled: false, publicEnabled: false, navLinkEnabled: false, githubCacheMinutes: 60 },
  getPublicCatalog: vi.fn(),
}));

vi.mock("@/app/lib/auth-guards", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/app/lib/mission-review-access", () => ({ isDreadPizzaRoberts: vi.fn() }));
vi.mock("@/app/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/app/lib/settings", () => ({ loadSettings: vi.fn(async () => ({})) }));
vi.mock("@/app/lib/features/link-check", () => ({ runLinkChecks: mocks.runLinkChecks }));
vi.mock("@/app/lib/features/seed-import", () => ({ importSeed: mocks.importSeed }));
vi.mock("@/app/lib/features/github", () => ({ sharedGithubClient: vi.fn(() => ({})) }));
vi.mock("@/app/lib/features/service", () => ({
  loadSwitches: vi.fn(async () => mocks.switches),
  getPublicCatalog: mocks.getPublicCatalog,
}));
vi.mock("@/app/lib/features/switches", () => ({ settingIsOn: vi.fn(() => null) }));

import { GET as listGET } from "./route";
import { POST as importPOST } from "./import/route";
import { POST as checkPOST } from "./check-links/route";
import { POST as publishPOST } from "./publish/route";
import { POST as appsPOST, PATCH as appsPATCH } from "./apps/route";
import { POST as entriesPOST, PATCH as entriesPATCH } from "./entries/route";
import { GET as cronGET } from "@/app/api/cron/feature-links/route";
import { GET as jsonGET } from "@/app/features.json/route";
import { GET as mdGET } from "@/app/features.md/route";
import { GET as llmsGET } from "@/app/llms.txt/route";
import { GET as navGET } from "@/app/api/public/features-nav/route";

const post = (body: unknown = {}, headers: Record<string, string> = {}) =>
  new Request("https://app.example/api/admin/features/x", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({ ok: true, session: { discordId: "admin1" } });
  mocks.switches.exportEnabled = false;
  mocks.switches.publicEnabled = false;
  mocks.switches.navLinkEnabled = false;
});

describe("admin routes require an admin", () => {
  const denied = () => mocks.requireAdmin.mockResolvedValue({ ok: false, response: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }) });

  it("rejects non-admins on every route without touching the database", async () => {
    denied();
    const responses = await Promise.all([
      listGET(),
      importPOST(post()),
      checkPOST(post()),
      publishPOST(post({ published: true })),
      appsPOST(post({ slug: "a", name: "A" })),
      appsPATCH(post({ slug: "a", patch: { name: "B" } })),
      entriesPOST(post({ slug: "e", appSlug: "a", title: "T", summary: "S" })),
      entriesPATCH(post({ slug: "e", patch: { title: "T" } })),
    ]);
    expect(responses.map((r) => r.status)).toEqual(Array(8).fill(403));
    for (const t of [mocks.prisma.featureApp, mocks.prisma.featureEntry]) for (const fn of Object.values(t)) expect(fn).not.toHaveBeenCalled();
    expect(mocks.importSeed).not.toHaveBeenCalled();
    expect(mocks.runLinkChecks).not.toHaveBeenCalled();
  });

  it("an admin can list, import and check links", async () => {
    expect((await listGET()).status).toBe(200);
    expect((await importPOST(post())).status).toBe(200);
    expect(mocks.importSeed).toHaveBeenCalledTimes(1);
    expect((await checkPOST(post())).status).toBe(200);
    expect(mocks.runLinkChecks).toHaveBeenCalledTimes(1);
  });

  it("writes need a JSON body and a same-origin request", async () => {
    const noJson = new Request("https://app.example/x", { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" });
    expect((await importPOST(noJson)).status).toBe(415);
    const cross = post({}, { origin: "https://evil.example", host: "app.example" });
    expect((await importPOST(cross)).status).toBe(403);
    expect(mocks.importSeed).not.toHaveBeenCalled();
  });

  it("validates edits: a javascript: live link, a bad status and unknown fields are refused", async () => {
    expect((await entriesPATCH(post({ slug: "e", patch: { liveUrl: "javascript:alert(1)" } }))).status).toBe(400);
    expect((await entriesPATCH(post({ slug: "e", patch: { status: "bogus" } }))).status).toBe(400);
    expect((await entriesPATCH(post({ slug: "e", patch: { toggleKey: "not.a.setting" } }))).status).toBe(400);
    expect((await entriesPATCH(post({ slug: "e", patch: { id: "x" } }))).status).toBe(400);
    expect(mocks.prisma.featureEntry.update).not.toHaveBeenCalled();
    mocks.prisma.featureEntry.update.mockResolvedValue({ slug: "e" } as never);
    expect((await entriesPATCH(post({ slug: "e", patch: { published: true, toggleKey: "passport.enabled" } }))).status).toBe(200);
  });
});

describe("cron", () => {
  it("rejects a call without the cron secret", async () => {
    const res = await cronGET(new NextRequest("https://app.example/api/cron/feature-links"));
    expect(res.status).toBe(401);
    expect(mocks.runLinkChecks).not.toHaveBeenCalled();
  });

  it("runs the link check with the secret", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const res = await cronGET(new NextRequest("https://app.example/api/cron/feature-links", { headers: { authorization: "Bearer s3cret" } }));
    expect(res.status).toBe(200);
    expect(mocks.runLinkChecks).toHaveBeenCalledTimes(1);
    vi.unstubAllEnvs();
  });
});

describe("public exports", () => {
  it("answer 404 while the export switch is off, without reading any rows", async () => {
    for (const get of [jsonGET, mdGET, llmsGET]) expect((await get()).status).toBe(404);
    expect(mocks.getPublicCatalog).not.toHaveBeenCalled();
  });

  it("serve the catalog when the switch is on", async () => {
    mocks.switches.exportEnabled = true;
    mocks.getPublicCatalog.mockResolvedValue({ catalog: { generatedAt: "2026-11-20T00:00:00.000Z", githubOk: true, apps: [], entries: [] }, switches: mocks.switches });
    const j = await jsonGET();
    expect(j.status).toBe(200);
    expect(j.headers.get("content-type")).toContain("application/json");
    expect(await j.json()).toMatchObject({ apps: [], features: [] });
    expect((await mdGET()).headers.get("content-type")).toContain("text/markdown");
    expect(await (await llmsGET()).text()).toMatch(/^# PizzaDAO/);
  });

  it("the header-link endpoint needs both the page and the link switch", async () => {
    expect(await (await navGET()).json()).toEqual({ enabled: false });
    mocks.switches.navLinkEnabled = true;
    expect(await (await navGET()).json()).toEqual({ enabled: false });
    mocks.switches.publicEnabled = true;
    expect(await (await navGET()).json()).toEqual({ enabled: true });
  });
});
