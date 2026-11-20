// @vitest-environment node
// The bank editor API: admin only, same-origin JSON writes, schema + lint validation, exposed handling, updatedBy, cache
// invalidation. The bank is the made-up fixture behind the in-memory store (vitest.setup.ts).
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/db");
vi.mock("@/app/lib/auth-guards", () => ({ requireAdmin: vi.fn() }));

import { GET, POST } from "./route";
import { requireAdmin } from "@/app/lib/auth-guards";
import { fakeBank } from "@/app/lib/trivia/__fixtures__/fake-bank-store";
import { getQuestion, invalidateBank, servable } from "@/app/lib/trivia/bank";
import type { TriviaQuestion } from "@/app/lib/trivia/schema";

const ADMIN = "900000000000000001";
const ok = { ok: true as const, session: { discordId: ADMIN } };
const post = (body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) =>
  POST(new Request("https://x.test/api/admin/trivia/questions", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }));
const get = (qs = "") => GET(new Request(`https://x.test/api/admin/trivia/questions${qs}`));

const fresh = (over: Partial<TriviaQuestion> = {}): TriviaQuestion => ({
  id: "pz-950",
  category: "pizzadao",
  type: "short_answer",
  difficulty: "easy",
  question: "What is the Fixture Town pizza mascot called?",
  answer: "Crusty",
  aliases: ["crusty the slice"],
  rejects: [],
  match: { kind: "text", fuzzy: true },
  explanation: "Made up.",
  sources: [{ url: "https://example.com/mascot", note: "Made up" }],
  status: "flagged",
  ...over,
});

beforeEach(() => {
  fakeBank.reset();
  invalidateBank();
  vi.mocked(requireAdmin).mockReset();
  vi.mocked(requireAdmin).mockResolvedValue(ok as never);
});

describe("auth", () => {
  it("a non-admin gets nothing: no list, no write", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ ok: false, response: Response.json({ error: "Forbidden" }, { status: 403 }) } as never);
    const g = await get();
    expect(g.status).toBe(403);
    expect(JSON.stringify(await g.json())).not.toContain("answer");
    const before = fakeBank.rows.size;
    expect((await post({ action: "create", question: fresh() })).status).toBe(403);
    expect((await post({ action: "status", id: "pd-901", status: "flagged" })).status).toBe(403);
    expect(fakeBank.rows.size).toBe(before);
    expect(fakeBank.rows.get("pd-901")!.status).toBe("approved");
  });

  it("writes need a JSON content type", async () => {
    expect((await post(JSON.stringify({ action: "create", question: fresh() }), { "content-type": "text/plain" })).status).toBe(415);
    expect(fakeBank.rows.has("pz-950")).toBe(false);
  });
});

describe("GET", () => {
  it("lists every row with the parsed question, filtered", async () => {
    fakeBank.setExposed(["pd-901"]);
    const all = (await (await get()).json()).questions;
    expect(all.length).toBe(fakeBank.rows.size);
    const web = (await (await get("?pool=web&status=approved")).json()).questions;
    expect(web.length).toBeGreaterThan(0);
    expect(web.every((r: { pool: string; status: string }) => r.pool === "web" && r.status === "approved")).toBe(true);
    const exposed = (await (await get("?exposed=true")).json()).questions;
    expect(exposed.map((r: { id: string }) => r.id)).toEqual(["pd-901"]);
    const cat = (await (await get("?category=jercos")).json()).questions;
    expect(cat.every((r: { category: string }) => r.category === "jercos")).toBe(true);
  });
});

describe("create", () => {
  it("creates a valid question, not exposed, with the actor", async () => {
    const res = await post({ action: "create", question: fresh() });
    expect(res.status).toBe(200);
    const { row } = await res.json();
    expect(row).toMatchObject({ id: "pz-950", status: "flagged", pool: null, category: "pizzadao", exposed: false, updatedBy: ADMIN });
    expect(fakeBank.rows.get("pz-950")!.updatedBy).toBe(ADMIN);
  });

  it("refuses an invalid question with the reasons, and a taken id", async () => {
    const bad = await post({ action: "create", question: { ...fresh(), sources: [{ url: "http://insecure.example", note: "x" }] } });
    expect(bad.status).toBe(400);
    expect((await bad.json()).errors.join(" ")).toMatch(/https/);
    expect((await post({ action: "create", question: { ...fresh(), status: "approved" } })).status).toBe(400); // approved needs a pool
    expect((await post({ action: "create", question: { ...fresh(), id: "not an id" } })).status).toBe(400);
    expect((await post({ action: "create", question: "nope" })).status).toBe(400);
    expect((await post({ action: "create", question: { ...fresh(), id: "pd-901" } })).status).toBe(409);
    expect(fakeBank.rows.has("pz-950")).toBe(false);
  });

  it("an approved question must pass the matcher lint (a reject that is accepted is refused)", async () => {
    const res = await post({ action: "create", question: fresh({ status: "approved", pool: "web", rejects: ["crusty"] }) });
    expect(res.status).toBe(400);
    expect((await res.json()).errors.join(" ")).toMatch(/accepted/);
  });

  it("is served at once in this instance (the cache is invalidated)", async () => {
    expect(await servable({ pool: "web" })).not.toContainEqual(expect.objectContaining({ id: "pz-950" }));
    await post({ action: "create", question: fresh({ status: "approved", pool: "web" }) });
    expect((await servable({ pool: "web" })).some((q) => q.id === "pz-950")).toBe(true);
  });

  it("garbage JSON and unknown actions are 400s", async () => {
    expect((await post("{nope")).status).toBe(400);
    expect((await post({ action: "explode" })).status).toBe(400);
  });
});

describe("update", () => {
  const current = async (id: string) => ({ ...((await getQuestion(id)) as TriviaQuestion) });

  it("rewording the question clears exposed; editing anything else keeps it", async () => {
    fakeBank.setExposed(["pd-905", "pd-901"]);
    invalidateBank();
    const q = await current("pd-905");
    const kept = await post({ action: "update", id: "pd-905", question: { ...q, explanation: "A better explanation." } });
    expect((await kept.json()).row.exposed).toBe(true);
    const reworded = await post({ action: "update", id: "pd-905", question: { ...q, question: "Which Fixture Town shop first sold a deep dish?" } });
    expect((await reworded.json()).row).toMatchObject({ exposed: false, updatedBy: ADMIN });
    const n = await current("pd-901");
    const newAnswer = await post({ action: "update", id: "pd-901", question: { ...n, answer: "12000", aliases: ["12,000"] } });
    expect((await newAnswer.json()).row.exposed).toBe(false);
  });

  it("the exposed flag can be set explicitly", async () => {
    const q = await current("pd-903");
    const res = await post({ action: "update", id: "pd-903", question: q, exposed: true });
    expect((await res.json()).row.exposed).toBe(true);
  });

  it("validates, keeps the id, and refuses a stale editor (409)", async () => {
    const q = await current("pd-902");
    expect((await post({ action: "update", id: "pd-902", question: { ...q, answer: "maybe" } })).status).toBe(400);
    expect((await post({ action: "update", id: "pd-902", question: { ...q, id: "pd-903" } })).status).toBe(400);
    expect((await post({ action: "update", id: "zz-999", question: q })).status).toBe(404);
    const stale = await post({ action: "update", id: "pd-902", question: { ...q, explanation: "x y z" }, expectUpdatedAt: "2020-01-01T00:00:00.000Z" });
    expect(stale.status).toBe(409);
    expect((fakeBank.rows.get("pd-902")!.data as TriviaQuestion).explanation).not.toBe("x y z");
    const okRes = await post({ action: "update", id: "pd-902", question: { ...q, explanation: "x y z" }, expectUpdatedAt: "2026-01-01T00:00:00.000Z" });
    expect(okRes.status).toBe(200);
  });
});

describe("status and pool", () => {
  it("approve needs a pool; flag and retire drop it; retire keeps a reason", async () => {
    const noPool = await post({ action: "status", id: "pz-908", status: "approved" });
    expect(noPool.status).toBe(400);
    const approved = await post({ action: "status", id: "pz-908", status: "approved", pool: "discord" });
    expect((await approved.json()).row).toMatchObject({ status: "approved", pool: "discord" });
    expect((await servable({ pool: "discord" })).some((q) => q.id === "pz-908")).toBe(true);

    const flagged = await post({ action: "status", id: "pz-908", status: "flagged" });
    expect((await flagged.json()).row).toMatchObject({ status: "flagged", pool: null });
    expect((await servable({ pool: "discord" })).some((q) => q.id === "pz-908")).toBe(false);

    const retired = await post({ action: "status", id: "pd-901", status: "rejected", rejectedReason: "Admin 2026-11-20: duplicate" });
    expect((await retired.json()).row.question).toMatchObject({ status: "rejected", rejectedReason: "Admin 2026-11-20: duplicate" });
    expect((await servable({ pool: "web" })).some((q) => q.id === "pd-901")).toBe(false);
  });

  it("moves an approved question to the other pool; never a fun question to discord", async () => {
    const moved = await post({ action: "status", id: "pd-901", status: "approved", pool: "discord" });
    expect((await moved.json()).row.pool).toBe("discord");
    expect((await post({ action: "status", id: "fun-902", status: "approved", pool: "discord" })).status).toBe(400);
    expect((await post({ action: "status", id: "pd-901", status: "nonsense" })).status).toBe(400);
    expect((await post({ action: "status", id: "pd-901", status: "approved", pool: "moon" })).status).toBe(400);
  });

  it("a status change keeps the exposed flag (the text did not change)", async () => {
    fakeBank.setExposed(["pd-901"]);
    const res = await post({ action: "status", id: "pd-901", status: "flagged" });
    expect((await res.json()).row.exposed).toBe(true);
  });
});
