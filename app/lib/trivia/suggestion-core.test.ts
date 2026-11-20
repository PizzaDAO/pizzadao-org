// @vitest-environment node
import { beforeAll, describe, it, expect } from "vitest";
import { getBank } from "./bank";
import { QuestionSchema } from "./schema";
import { buildQuestionSnippet, isHttpUrl, nextQuestionId, parseCategory, snippetJson, validateSuggestion, type SuggestionPayload } from "./suggestion-core";

const ok = { question: "Which bitcointalk user proposed the word satoshi?", answer: "ribuck", source: "https://bitcointalk.org/index.php?topic=1" };

describe("validateSuggestion", () => {
  it("accepts a plain suggestion and trims/collapses whitespace", () => {
    const r = validateSuggestion({ ...ok, question: "  Which   bitcointalk user proposed the word satoshi?  ", aliases: " Ribuck ,  ribuck_ ,\nribuck " });
    expect(r).toEqual({ ok: true, value: { question: "Which bitcointalk user proposed the word satoshi?", answer: "ribuck", aliases: ["ribuck_"], source: ok.source, category: null } });
  });

  it("checks the question length (8 to 300)", () => {
    expect(validateSuggestion({ ...ok, question: "short" })).toEqual({ ok: false, error: "question" });
    expect(validateSuggestion({ ...ok, question: "x".repeat(301) })).toEqual({ ok: false, error: "question" });
    expect(validateSuggestion({ ...ok, question: "x".repeat(300) }).ok).toBe(true);
    expect(validateSuggestion({ ...ok, question: 42 })).toEqual({ ok: false, error: "question" });
  });

  it("checks the answer length (1 to 120)", () => {
    expect(validateSuggestion({ ...ok, answer: "  " })).toEqual({ ok: false, error: "answer" });
    expect(validateSuggestion({ ...ok, answer: "a".repeat(121) })).toEqual({ ok: false, error: "answer" });
  });

  it("limits the aliases (8 of up to 80 characters)", () => {
    expect(validateSuggestion({ ...ok, aliases: Array.from({ length: 9 }, (_, i) => `a${i}`).join(",") })).toEqual({ ok: false, error: "aliases" });
    expect(validateSuggestion({ ...ok, aliases: "a".repeat(81) })).toEqual({ ok: false, error: "aliases" });
    expect(validateSuggestion({ ...ok, aliases: 5 })).toEqual({ ok: false, error: "aliases" });
    expect(validateSuggestion({ ...ok, aliases: undefined })).toMatchObject({ ok: true, value: { aliases: [] } });
  });

  it("drops an alias that repeats the answer", () => {
    expect(validateSuggestion({ ...ok, aliases: "RIBUCK, ribuck_" })).toMatchObject({ ok: true, value: { aliases: ["ribuck_"] } });
  });

  it("the source must be an http(s) URL", () => {
    for (const bad of ["", "bitcointalk.org", "ftp://x.com/a", "javascript:alert(1)", "https://", "https://localhost", "not a url"]) {
      expect(validateSuggestion({ ...ok, source: bad })).toEqual({ ok: false, error: "source" });
    }
    expect(validateSuggestion({ ...ok, source: "http://example.com/a" }).ok).toBe(true);
    expect(validateSuggestion({ ...ok, source: `https://example.com/${"a".repeat(300)}` })).toEqual({ ok: false, error: "source" });
    expect(isHttpUrl("https://example.com")).toBe(true);
  });

  it("the category is optional and must be a real one", () => {
    expect(validateSuggestion({ ...ok, category: "" })).toMatchObject({ ok: true, value: { category: null } });
    expect(validateSuggestion({ ...ok, category: "Pizza Day" })).toMatchObject({ ok: true, value: { category: "pizza-day" } });
    expect(validateSuggestion({ ...ok, category: "Bitcoin Pizza Day" })).toMatchObject({ ok: true, value: { category: "pizza-day" } });
    expect(validateSuggestion({ ...ok, category: "cooking" })).toEqual({ ok: false, error: "category" });
    expect(parseCategory(undefined)).toBeNull();
  });
});

const payload = (over: Partial<SuggestionPayload> = {}): SuggestionPayload => ({ question: "How many bitcoins was the first pizza?", answer: "10,000", aliases: ["10k"], source: "https://bitcointalk.org/index.php?topic=137.0", category: "pizza-day", ...over });

describe("nextQuestionId", () => {
  it("is the highest number under the category's prefix plus one, zero padded", () => {
    expect(nextQuestionId("pizza-day", ["pd-001", "pd-019", "pz-020"])).toBe("pd-020");
    expect(nextQuestionId("pizzadao", [])).toBe("pz-001");
    expect(nextQuestionId("satoshi", ["eb-037"])).toBe("eb-038"); // satoshi shares the eb prefix
    expect(nextQuestionId("just-for-fun", ["fun-002"])).toBe("fun-003");
  });

  it("is free in the (fixture) bank for every category", async () => {
    const ids = new Set((await getBank()).questions.map((q) => q.id));
    for (const c of ["pizza-day", "jercos", "early-bitcoin", "satoshi", "protocol", "myth-busting", "pizzadao", "just-for-fun"] as const) {
      expect(ids.has(nextQuestionId(c, ids))).toBe(false);
    }
  });
});

describe("buildQuestionSnippet", () => {
  let ids: string[] = [];
  beforeAll(async () => {
    ids = (await getBank()).questions.map((q) => q.id);
  });

  it("is a valid bank entry: flagged (not served), no pool, one https source", () => {
    const q = buildQuestionSnippet(payload(), ids, 7);
    expect(() => QuestionSchema.parse(q)).not.toThrow();
    expect(q).toMatchObject({ category: "pizza-day", status: "flagged", type: "short_answer", answer: "10000", aliases: ["10k"], match: { kind: "number", tolerance: 0 } });
    expect(q.pool).toBeUndefined();
    expect(q.id).toBe(nextQuestionId("pizza-day", ids));
    expect(q.notes).toContain("#7");
    expect(q.sources).toHaveLength(1);
  });

  it("infers true/false, numbers and text", () => {
    expect(buildQuestionSnippet(payload({ answer: "True", aliases: [] }), ids)).toMatchObject({ type: "true_false", answer: "true", match: { kind: "boolean" } });
    expect(buildQuestionSnippet(payload({ answer: "ribuck", aliases: [] }), ids)).toMatchObject({ type: "short_answer", match: { kind: "text", fuzzy: true } });
    expect(buildQuestionSnippet(payload({ answer: "SHA", aliases: [] }), ids)).toMatchObject({ match: { kind: "text", fuzzy: false } });
  });

  it("every inferred shape passes the bank schema", () => {
    for (const answer of ["True", "false", "21,000,000", "0.5", "ribuck", "a"]) {
      for (const category of [null, "satoshi", "just-for-fun"] as const) {
        expect(() => QuestionSchema.parse(buildQuestionSnippet(payload({ answer, category, aliases: [] }), ids))).not.toThrow();
      }
    }
  });

  it("uses a default category (and says so) when none was given", () => {
    const q = buildQuestionSnippet(payload({ category: null }), ids);
    expect(q.category).toBe("pizzadao");
    expect(q.notes).toMatch(/No category/);
  });

  it("upgrades an http source to https (the schema needs https) and notes it", () => {
    const q = buildQuestionSnippet(payload({ source: "http://example.com/x" }), ids);
    expect(q.sources[0].url).toBe("https://example.com/x");
    expect(q.notes).toMatch(/http/);
    expect(() => QuestionSchema.parse(q)).not.toThrow();
  });

  it("just-for-fun gets the required label", () => {
    expect(buildQuestionSnippet(payload({ category: "just-for-fun" }), ids).label).toBe("Just for fun");
  });

  it("snippetJson is pretty JSON that parses back to the same entry", () => {
    const json = snippetJson(payload(), ids, 3);
    expect(json).toContain("\n  \"id\"");
    expect(JSON.parse(json)).toEqual(JSON.parse(JSON.stringify(buildQuestionSnippet(payload(), ids, 3))));
  });
});
