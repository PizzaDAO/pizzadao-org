// The bank loader (DB-backed, cached), what is served, and answer secrecy. The bank here is the MADE-UP fixture
// (__fixtures__/questions.fixture.json) behind the in-memory store that vitest.setup.ts puts in place of bank-store.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "./__fixtures__/questions.fixture.json";
import { fakeBank } from "./__fixtures__/fake-bank-store";
import { QuestionSchema } from "./schema";
import { lintQuestion } from "./bank-lint";
import { BANK_TTL_MS, bankStats, getBank, getQuestion, invalidateBank, publicView, reveal, servable, validUntilMs } from "./bank";

const DAY = 24 * 60 * 60 * 1000;

/** Every key anywhere in a JSON value. */
function allKeys(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => allKeys(x, out));
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      allKeys(x, out);
    }
  }
  return out;
}

beforeEach(() => {
  fakeBank.reset();
  invalidateBank();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("fixture bank", () => {
  it("every entry passes the schema, approved ones the matcher lint, ids are unique", () => {
    const ids = new Set<string>();
    for (const raw of fixture.questions) {
      const q = QuestionSchema.parse(raw);
      expect(lintQuestion(q), q.id).toEqual([]);
      expect(ids.has(q.id)).toBe(false);
      ids.add(q.id);
    }
  });

  it("is loaded in full by getBank", async () => {
    const bank = await getBank();
    expect(bank.available).toBe(true);
    expect(bank.questions.map((q) => q.id)).toEqual([...fixture.questions.map((q) => q.id)].sort());
    expect(bank.invalid).toEqual([]);
  });

  it("the schema rejects a malformed question", async () => {
    const { questions } = await getBank();
    const q = questions[0];
    expect(QuestionSchema.safeParse({ ...q, sources: [{ url: "http://insecure.example", note: "x" }] }).success).toBe(false);
    expect(QuestionSchema.safeParse({ ...q, status: "approved", pool: undefined }).success).toBe(false);
    expect(QuestionSchema.safeParse({ ...q, surprise: 1 }).success).toBe(false);
    const mc = questions.find((x) => x.type === "multiple_choice")!;
    expect(QuestionSchema.safeParse({ ...mc, answer: "not a choice" }).success).toBe(false);
  });

  it("a just-for-fun or fun-* question can never be in the discord pool", async () => {
    for (const id of ["fun-901", "fun-902"]) {
      const fun = (await getQuestion(id))!;
      expect(QuestionSchema.safeParse({ ...fun, pool: "discord" }).success).toBe(false);
    }
  });

  it("the lint catches an alias the matcher refuses and a reject it accepts", async () => {
    const q = (await getQuestion("pd-901"))!;
    const tooLong = "ten thousand olives ".repeat(5); // past the matcher's length limit: never accepted
    expect(lintQuestion({ ...q, aliases: [tooLong] })).not.toEqual([]);
    expect(lintQuestion({ ...q, rejects: ["10,000"] })).not.toEqual([]);
    expect(lintQuestion({ ...q, status: "flagged", pool: undefined, aliases: [tooLong] })).toEqual([]); // drafts are only schema-checked
  });
});

describe("what is served", () => {
  const now = new Date("2026-11-18T00:00:00Z");

  it("only approved questions; flagged, needs_snax and rejected ones never", async () => {
    const web = await servable({ now, pool: "web" });
    const discord = await servable({ now, pool: "discord" });
    for (const q of [...web, ...discord]) expect(q.status).toBe("approved");
    const ids = new Set([...web, ...discord].map((q) => q.id));
    for (const id of ["pz-908", "eb-935", "pd-912", "bt-900"]) {
      expect(await getQuestion(id), id).toBeDefined();
      expect(ids.has(id), `${id} must not be servable`).toBe(false);
    }
  });

  it("the web and Discord pools never overlap, and fun questions are web only", async () => {
    const web = await servable({ now, pool: "web" });
    const d = new Set((await servable({ now, pool: "discord" })).map((q) => q.id));
    for (const q of web) expect(d.has(q.id)).toBe(false);
    for (const id of d) expect(id.startsWith("fun-")).toBe(false);
    expect(web.some((q) => q.id === "fun-902")).toBe(true);
  });

  it("disabled ids and expired questions are skipped", async () => {
    const web = await servable({ now, pool: "web" });
    const victim = web[0].id;
    expect((await servable({ now, pool: "web", disabledIds: [victim] })).some((q) => q.id === victim)).toBe(false);
    const withExpiry = (await getQuestion("pd-906"))!;
    const after = new Date(validUntilMs(withExpiry.validUntil!) + DAY);
    expect((await servable({ now, pool: "web" })).some((q) => q.id === withExpiry.id)).toBe(true);
    expect((await servable({ now: after, pool: "web" })).some((q) => q.id === withExpiry.id)).toBe(false);
  });

  it("validUntil: a plain date retires at the end of that day", () => {
    expect(validUntilMs("2028-04-01")).toBe(Date.parse("2028-04-02T00:00:00Z"));
    expect(validUntilMs("garbage")).toBe(0);
  });
});

describe("loader: cache, invalidation, broken rows, outages", () => {
  it("reads the database once per TTL", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-20T00:00:00Z"), toFake: ["Date"] });
    await getBank();
    await getBank();
    await servable({ pool: "web" });
    expect(fakeBank.reads).toBe(1);
    vi.setSystemTime(Date.now() + BANK_TTL_MS + 1);
    await getBank();
    expect(fakeBank.reads).toBe(2);
  });

  it("concurrent first reads share one query", async () => {
    await Promise.all([getBank(), getBank(), getQuestion("pd-901"), servable({ pool: "discord" })]);
    expect(fakeBank.reads).toBe(1);
  });

  it("invalidateBank makes the next read see a change at once", async () => {
    expect(await getQuestion("pd-901")).toBeDefined();
    fakeBank.rows.delete("pd-901");
    expect(await getQuestion("pd-901")).toBeDefined(); // still cached
    invalidateBank();
    expect(await getQuestion("pd-901")).toBeUndefined();
  });

  it("a write while a read is in flight does not cache the stale read", async () => {
    const first = getBank();
    invalidateBank();
    fakeBank.rows.delete("pd-901");
    await first;
    expect(await getQuestion("pd-901")).toBeUndefined();
  });

  it("a row that fails the schema (or whose data id differs) is never served", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = fakeBank.rows.get("pd-901")!;
    bad.data = { ...(bad.data as object), answer: "" };
    const wrongId = fakeBank.rows.get("pd-903")!;
    wrongId.data = { ...(wrongId.data as object), id: "pd-999" };
    const bank = await getBank();
    expect(bank.questions.some((q) => q.id === "pd-901" || q.id === "pd-903" || q.id === "pd-999")).toBe(false);
    expect(bank.invalid.map((i) => i.id).sort()).toEqual(["pd-901", "pd-903"]);
  });

  it("an empty bank: nothing servable, a warning, available", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fakeBank.set([]);
    const bank = await getBank();
    expect(bank).toMatchObject({ questions: [], available: true });
    expect(await servable({ pool: "discord" })).toEqual([]);
    expect(warn.mock.calls.some((c) => String(c[0]).includes("empty"))).toBe(true);
  });

  it("an unreachable database with nothing cached: an empty, unavailable bank (never throws)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeBank.fail = new Error("connection refused");
    const bank = await getBank();
    expect(bank).toMatchObject({ questions: [], available: false });
    expect(await servable({ pool: "web" })).toEqual([]);
    expect(await getQuestion("pd-901")).toBeUndefined();
    expect(err.mock.calls.some((c) => String(c[0]).includes("unavailable"))).toBe(true);
    // It retries soon, not on every request.
    const reads = fakeBank.reads;
    await getBank();
    expect(fakeBank.reads).toBe(reads);
  });

  it("an unreachable database after a good read keeps serving the last good copy", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers({ now: new Date("2026-11-20T00:00:00Z"), toFake: ["Date"] });
    const good = (await getBank()).questions.length;
    fakeBank.fail = new Error("connection refused");
    vi.setSystemTime(Date.now() + BANK_TTL_MS + 1);
    const bank = await getBank();
    expect(bank.questions.length).toBe(good);
    expect(bank.available).toBe(true);
  });

  it("exposed flags come from the rows", async () => {
    fakeBank.setExposed(["pd-901", "pd-902"]);
    invalidateBank();
    expect([...(await getBank()).exposedIds].sort()).toEqual(["pd-901", "pd-902"]);
  });
});

describe("answer secrecy", () => {
  const FORBIDDEN = ["answer", "aliases", "rejects", "match", "explanation", "sources", "notes", "status", "pool", "validUntil", "tolerance", "fuzzy", "rejectedReason"];

  it("publicView never contains an answer field, at any depth, for any question", async () => {
    for (const q of (await getBank()).questions) {
      const keys = allKeys(publicView(q));
      for (const f of FORBIDDEN) expect(keys.has(f), `${q.id} leaks ${f}`).toBe(false);
    }
  });

  it("publicView carries no answer text either", async () => {
    const { questions } = await getBank();
    for (const q of questions.filter((x) => x.type === "true_false")) {
      expect(JSON.stringify(publicView(q))).not.toMatch(new RegExp(`"${q.answer}"`));
    }
    for (const q of questions.filter((x) => x.type === "short_answer")) {
      expect(JSON.stringify(publicView(q)).toLowerCase()).not.toContain(`"${q.answer.toLowerCase()}"`);
    }
    const mc = questions.find((q) => q.type === "multiple_choice")!;
    expect(publicView(mc).choices).toEqual(mc.choices); // the choices are the question, not the answer
  });

  it("reveal shows the answer, explanation and sources, never aliases, rejects or notes", async () => {
    for (const q of (await getBank()).questions.filter((x) => x.status === "approved")) {
      const keys = allKeys(reveal(q));
      for (const f of ["aliases", "rejects", "match", "notes", "status"]) expect(keys.has(f), `${q.id} reveals ${f}`).toBe(false);
      expect(reveal(q).sources.length).toBeGreaterThan(0);
    }
    expect(reveal((await getQuestion("pd-902"))!).answer).toBe("True");
  });
});

describe("nothing in the app bundles a bank", () => {
  it("no app source imports a question JSON (the fixture is for tests only; the real bank is in the database)", async () => {
    const { readdirSync, readFileSync, existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    expect(existsSync(join(process.cwd(), "data/trivia/questions.json"))).toBe(false);
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== "node_modules" && e.name !== "__fixtures__") walk(p);
        } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
          const src = readFileSync(p, "utf8");
          if (/from\s+["'][^"']*(questions(\.fixture)?\.json|trivia\/__fixtures__)[^"']*["']/.test(src)) offenders.push(p);
        }
      }
    };
    walk(join(process.cwd(), "app"));
    expect(offenders).toEqual([]);
  });
});

describe("stats", () => {
  it("counts what is served and what is held back", async () => {
    fakeBank.setExposed(["pd-901", "pz-908"]);
    invalidateBank();
    const s = await bankStats(new Date("2026-11-18T00:00:00Z"));
    expect(s.available).toBe(true);
    expect(s.total).toBe(fixture.questions.length);
    expect(s.servableDiscord + s.servableWeb).toBe(s.byStatus.approved);
    expect(s.exposedApproved).toBe(1); // pz-908 is flagged
    expect(s.notServed.map((x) => x.id)).toEqual(expect.arrayContaining(["pz-908", "eb-935", "pd-912", "bt-900"]));
  });
});
