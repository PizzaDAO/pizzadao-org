import { describe, expect, it } from "vitest";
import raw from "@/data/trivia/questions.json";
import { BankSchema, QuestionSchema } from "./schema";
import { bankStats, getBank, getQuestion, publicView, reveal, servable, validUntilMs } from "./bank";

const bank = getBank();
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

describe("bank file", () => {
  it("passes the schema (unique ids, https sources, MC answer in choices...)", () => {
    expect(() => BankSchema.parse(raw)).not.toThrow();
    expect(new Set(bank.questions.map((q) => q.id)).size).toBe(bank.questions.length);
  });

  it("rejects a malformed question", () => {
    const q = bank.questions[0];
    expect(QuestionSchema.safeParse({ ...q, sources: [{ url: "http://insecure.example", note: "x" }] }).success).toBe(false);
    expect(QuestionSchema.safeParse({ ...q, status: "approved", pool: undefined }).success).toBe(false);
    expect(QuestionSchema.safeParse({ ...q, surprise: 1 }).success).toBe(false);
    const mc = bank.questions.find((x) => x.type === "multiple_choice")!;
    expect(QuestionSchema.safeParse({ ...mc, answer: "not a choice" }).success).toBe(false);
  });

  it("a just-for-fun or fun-* question can never be in the discord pool", () => {
    const fun = bank.questions.find((q) => q.id === "fun-002")!;
    expect(QuestionSchema.safeParse({ ...fun, pool: "discord" }).success).toBe(false);
    const fun1 = bank.questions.find((q) => q.id === "fun-001")!;
    expect(QuestionSchema.safeParse({ ...fun1, pool: "discord" }).success).toBe(false);
  });

  it("no validUntil is in the past or within 60 days: someone must re-check it first", () => {
    const horizon = Date.now() + 60 * DAY;
    for (const q of bank.questions.filter((x) => x.validUntil)) {
      expect(validUntilMs(q.validUntil!), `${q.id} validUntil ${q.validUntil} needs a re-check`).toBeGreaterThan(horizon);
    }
  });
});

describe("what is served", () => {
  const now = new Date("2026-11-18T00:00:00Z");
  const web = servable({ now, pool: "web" });
  const discord = servable({ now, pool: "discord" });

  it("only approved questions, with their decisions applied", () => {
    for (const q of [...web, ...discord]) expect(q.status).toBe("approved");
    const ids = new Set([...web, ...discord].map((q) => q.id));
    // Snax: flagged facts stay out until verified; the rejected original stays out.
    for (const id of ["pz-008", "eb-035", "eb-036", "eb-037", "bt-000"]) {
      expect(getQuestion(id), id).toBeDefined();
      expect(ids.has(id), `${id} must not be servable`).toBe(false);
    }
    // fun-002 approved (web only); pz-005 and jc-002 stay in.
    expect(getQuestion("fun-002")!.status).toBe("approved");
    expect(web.some((q) => q.id === "fun-002")).toBe(true);
    expect(ids.has("pz-005")).toBe(true);
    expect(ids.has("jc-002")).toBe(true);
  });

  it("the web and Discord pools never overlap, and fun questions are web only", () => {
    const d = new Set(discord.map((q) => q.id));
    for (const q of web) expect(d.has(q.id)).toBe(false);
    for (const q of discord) {
      expect(q.id.startsWith("fun-")).toBe(false);
      expect(q.category).not.toBe("just-for-fun");
    }
  });

  it("about a third is reserved for Discord, and every category has a Discord share", () => {
    const total = web.length + discord.length;
    expect(discord.length / total).toBeGreaterThan(0.28);
    expect(discord.length / total).toBeLessThan(0.36);
    expect(discord.length).toBeGreaterThanOrEqual(20); // 3 rounds a day: about a week without repeats
    const cats = new Set(web.map((q) => q.category));
    for (const c of cats) if (c !== "just-for-fun" && c !== "myth-busting") expect(discord.some((q) => q.category === c), c).toBe(true);
  });

  it("disabled ids and expired questions are skipped", () => {
    const victim = web[0].id;
    expect(servable({ now, pool: "web", disabledIds: [victim] }).some((q) => q.id === victim)).toBe(false);
    const withExpiry = bank.questions.find((q) => q.validUntil && q.status === "approved")!;
    const after = new Date(validUntilMs(withExpiry.validUntil!) + DAY);
    const pool = withExpiry.pool!;
    expect(servable({ now, pool }).some((q) => q.id === withExpiry.id)).toBe(true);
    expect(servable({ now: after, pool }).some((q) => q.id === withExpiry.id)).toBe(false);
  });

  it("validUntil: a plain date retires at the end of that day", () => {
    expect(validUntilMs("2028-04-01")).toBe(Date.parse("2028-04-02T00:00:00Z"));
    expect(validUntilMs("garbage")).toBe(0);
  });
});

describe("answer secrecy", () => {
  const FORBIDDEN = ["answer", "aliases", "rejects", "match", "explanation", "sources", "notes", "status", "pool", "validUntil", "tolerance", "fuzzy"];

  it("publicView never contains an answer field, at any depth, for any question", () => {
    for (const q of bank.questions) {
      const keys = allKeys(publicView(q));
      for (const f of FORBIDDEN) expect(keys.has(f), `${q.id} leaks ${f}`).toBe(false);
    }
  });

  it("publicView carries no answer text either", () => {
    for (const q of bank.questions.filter((x) => x.type === "true_false")) {
      expect(JSON.stringify(publicView(q))).not.toMatch(new RegExp(`"${q.answer}"`));
    }
    const mc = bank.questions.find((q) => q.type === "multiple_choice")!;
    expect(publicView(mc).choices).toEqual(mc.choices); // the choices are the question, not the answer
  });

  it("reveal shows the answer, explanation and sources, never aliases, rejects or notes", () => {
    for (const q of bank.questions.filter((x) => x.status === "approved")) {
      const keys = allKeys(reveal(q));
      for (const f of ["aliases", "rejects", "match", "notes", "status"]) expect(keys.has(f), `${q.id} reveals ${f}`).toBe(false);
      expect(reveal(q).sources.length).toBeGreaterThan(0);
    }
    expect(reveal(getQuestion("pd-007")!).answer).toBe("True");
  });
});

describe("stats", () => {
  it("counts what is served and what is held back", () => {
    const s = bankStats(new Date("2026-11-18T00:00:00Z"));
    expect(s.total).toBe(bank.questions.length);
    expect(s.servableDiscord + s.servableWeb).toBe(s.byStatus.approved);
    expect(s.notServed.map((x) => x.id)).toEqual(expect.arrayContaining(["pz-008", "eb-035", "eb-036", "eb-037", "bt-000"]));
  });
});
