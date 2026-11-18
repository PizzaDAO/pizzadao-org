import { describe, expect, it } from "vitest";
import raw from "@/data/trivia/questions.json";
import { BankSchema, type TriviaQuestion } from "./schema";
import { editDistance, fuzzyThreshold, match, parseNumbers, parseBoolean, parseChoiceLetter } from "./match";

const bank = BankSchema.parse(raw);
const byId = (id: string): TriviaQuestion => {
  const q = bank.questions.find((x) => x.id === id);
  if (!q) throw new Error(`no question ${id}`);
  return q;
};
const verdict = (id: string, input: string) => match(byId(id), input).verdict;
const approved = bank.questions.filter((q) => q.status === "approved");

describe("bank-driven: every approved question", () => {
  it.each(approved.map((q) => [q.id, q] as const))("%s: its answer and every alias match", (_id, q) => {
    const accepted = [q.answer, ...q.aliases];
    if (q.match.kind === "boolean") accepted.push(q.answer === "true" ? "yes" : "no");
    for (const a of accepted) expect(match(q, a).verdict, `"${a}" should be correct`).toBe("correct");
  });

  it.each(approved.map((q) => [q.id, q] as const))("%s: every reject fails", (_id, q) => {
    for (const r of q.rejects) expect(match(q, r).verdict, `"${r}" must never be correct`).not.toBe("correct");
  });

  it.each(approved.filter((q) => q.match.kind === "boolean").map((q) => [q.id, q] as const))("%s: the opposite boolean is wrong", (_id, q) => {
    expect(match(q, q.answer === "true" ? "false" : "true").verdict).toBe("wrong");
  });

  it.each(approved.filter((q) => q.type === "multiple_choice").map((q) => [q.id, q] as const))("%s: only the right choice (text or letter) wins", (_id, q) => {
    const letters = "abcd";
    q.choices!.forEach((c, i) => {
      const expected = c === q.answer ? "correct" : "wrong";
      expect(match(q, c).verdict, `text "${c}"`).toBe(expected);
      expect(match(q, letters[i]).verdict, `letter ${letters[i]}`).toBe(expected);
      expect(match(q, `(${letters[i]})`).verdict).toBe(expected);
      expect(match(q, `option ${letters[i].toUpperCase()}`).verdict).toBe(expected);
    });
  });
});

describe("boolean", () => {
  it("Volt's case: Trie and True both match true", () => {
    expect(verdict("pd-007", "Trie")).toBe("correct");
    expect(verdict("pd-007", "True")).toBe("correct");
  });
  it.each(["true", "TRUE", "t", "yes", "y", "yep", "yeah", "correct", "right", "✅", "\u{1F44D}", "ture", "trie", "it's true", "I think true", "**true**", "true!", "answer: true"])(
    "accepts %s as true",
    (s) => expect(parseBoolean(s)).toBe(true),
  );
  it.each(["false", "f", "no", "n", "nope", "wrong", "incorrect", "❌", "\u{1F44E}", "flase", "fasle", "fales"])("accepts %s as false", (s) =>
    expect(parseBoolean(s)).toBe(false),
  );
  it.each(["maybe", "lol", "hello there", "tr", "trash", "idk"])("%s is not an answer (ignore)", (s) => {
    expect(verdict("pd-007", s)).toBe("ignore");
  });
  it("a wrong boolean is wrong, not ignored", () => {
    expect(verdict("pd-012", "true")).toBe("wrong"); // pd-012 is false
    expect(verdict("pd-012", "flase")).toBe("correct");
  });
});

describe("numbers", () => {
  it("9,900 / 9900 / 9 900 / 9.9k all read as 9900", () => {
    for (const s of ["9,900", "9900", "9 900", "9.9k"]) expect(parseNumbers(s).flat()).toContain(9900);
  });
  it("10.000 reads as ten thousand (and as 10: both readings are offered)", () => {
    expect(parseNumbers("10.000")[0]).toContain(10000);
    expect(verdict("pd-001", "10.000")).toBe("correct");
  });
  it("0.99 is not 99", () => {
    expect(verdict("pd-011", "0.99")).toBe("correct");
    expect(verdict("pd-011", ".99")).toBe("correct");
    expect(verdict("pd-011", "99")).toBe("wrong");
    expect(parseNumbers("0.99")[0]).toEqual([0.99]);
  });
  it("3.125 is a decimal for the subsidy question", () => {
    expect(verdict("pr-004", "3.125")).toBe("correct");
    expect(verdict("pr-004", "6.25")).toBe("wrong");
  });
  it("never fuzzy on digits", () => {
    expect(verdict("pd-001", "9,800")).toBe("wrong");
    expect(verdict("pd-001", "10001")).toBe("wrong");
    expect(verdict("pd-009", "57044")).toBe("wrong");
  });
  it("suffixes, words and exponents", () => {
    expect(verdict("pd-001", "10k")).toBe("correct");
    expect(verdict("pd-001", "ten thousand")).toBe("correct");
    expect(verdict("pd-001", "10,000 BTC")).toBe("correct");
    expect(verdict("pr-009", "1e8")).toBe("correct");
    expect(verdict("pr-009", "10^8")).toBe("correct");
    expect(verdict("pr-009", "one hundred million")).toBe("correct");
    expect(verdict("pr-009", "100 million")).toBe("correct");
    expect(verdict("eb-004", "nine")).toBe("correct");
    expect(verdict("pr-001", "$50")).toBe("correct");
  });
  it("184 billion passes eb-020 (tolerance), 21 million fails", () => {
    expect(verdict("eb-020", "184 billion")).toBe("correct");
    expect(verdict("eb-020", "184,467,440,737")).toBe("correct");
    expect(verdict("eb-020", "92 billion")).toBe("wrong");
    expect(verdict("eb-020", "21 million")).toBe("wrong");
  });
  it("no number, or several, is not an attempt", () => {
    expect(verdict("pd-001", "no idea")).toBe("ignore");
    expect(verdict("pd-001", "10000 or 20000")).toBe("ignore");
    expect(verdict("pd-001", "lol")).toBe("ignore");
  });
  it("percent and dates", () => {
    expect(verdict("pz-006", "51%")).toBe("correct");
    expect(verdict("pz-006", "49")).toBe("wrong");
    expect(verdict("pd-003", "2010")).toBe("correct");
    expect(verdict("pd-003", "2011")).toBe("wrong");
  });
});

describe("text", () => {
  it("rejects beat fuzzy and aliases", () => {
    expect(verdict("pd-004", "domino's")).toBe("wrong");
    expect(verdict("pd-004", "dominos")).toBe("wrong");
    expect(verdict("pd-004", "Papa John's")).toBe("correct");
    expect(verdict("pd-004", "papa johns")).toBe("correct");
  });
  it("negation blocks containment", () => {
    expect(verdict("eb-013", "not hal finney")).toBe("wrong");
  });
  it("plain pineapple does not count for fun-002, pineapple jalapeno does", () => {
    expect(verdict("fun-002", "pineapple")).toBe("wrong");
    expect(verdict("fun-002", "Pineapple Jalapeño")).toBe("correct");
    expect(verdict("fun-002", "pineapple and jalapenos")).toBe("correct");
    expect(verdict("fun-002", "pineappel jalapeno")).toBe("correct"); // typo, fuzzy
  });
  it("a wrong text guess is wrong", () => {
    expect(verdict("fun-002", "pepperoni")).toBe("wrong");
  });
  it("fuzzy thresholds scale with length", () => {
    expect(fuzzyThreshold(4)).toBe(0);
    expect(fuzzyThreshold(5)).toBe(1);
    expect(fuzzyThreshold(9)).toBe(2);
    expect(fuzzyThreshold(16)).toBe(3);
    expect(editDistance("true", "ture")).toBe(1);
    expect(editDistance("kitten", "sitting")).toBe(3);
  });
  it("diacritics and markdown are ignored", () => {
    expect(verdict("fun-002", "||PINEAPPLE jalapeño||")).toBe("correct");
  });
});

describe("multiple choice", () => {
  it("parses letters", () => {
    expect(parseChoiceLetter("b")).toBe(1);
    expect(parseChoiceLetter("(c)")).toBe(2);
    expect(parseChoiceLetter("d)")).toBe(3);
    expect(parseChoiceLetter("a.")).toBe(0);
    expect(parseChoiceLetter("option B")).toBe(1);
    expect(parseChoiceLetter("\u{1F171}️")).toBe(1);
    expect(parseChoiceLetter("bob")).toBeNull();
  });
  it("chit-chat is not an attempt", () => {
    expect(verdict("pd-004", "lol no idea")).toBe("ignore");
    expect(verdict("pd-004", "e")).toBe("ignore");
  });
  it("naming another choice is wrong", () => {
    expect(verdict("pd-004", "Pizza Hut")).toBe("wrong");
    expect(verdict("pd-004", "papa johns pizza")).toBe("correct");
  });
});

describe("pre-filter", () => {
  const q = () => byId("pd-001");
  it("ignores long chat and answer dumps", () => {
    expect(match(q(), "x".repeat(81)).verdict).toBe("ignore");
    expect(match(q(), "10000 is it and many other words follow here ok").verdict).toBe("ignore");
  });
  it("strips mentions, channel and emoji tags and urls", () => {
    expect(match(q(), "<@123456789> 10000").verdict).toBe("correct");
    expect(match(q(), "<#123> <:pizza:12345> 10000 https://example.com/x").verdict).toBe("correct");
  });
  it("empty and non-string input is ignored", () => {
    expect(match(q(), "").verdict).toBe("ignore");
    expect(match(q(), "   ").verdict).toBe("ignore");
    expect(match(q(), null).verdict).toBe("ignore");
    expect(match(q(), 42).verdict).toBe("ignore");
  });
});

describe("fuzz", () => {
  it("never throws on random Unicode", () => {
    let seed = 1234567;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const sample = bank.questions.slice(0, 40);
    for (let i = 0; i < 400; i++) {
      const len = Math.floor(rnd() * 90);
      let s = "";
      for (let j = 0; j < len; j++) {
        const cp = rnd() < 0.5 ? Math.floor(rnd() * 0x250) : Math.floor(rnd() * 0x1ffff);
        if (cp >= 0xd800 && cp <= 0xdfff) continue; // lone surrogates are not valid scalar values
        s += String.fromCodePoint(cp);
      }
      for (const q of sample) {
        const v = match(q, s).verdict;
        expect(["correct", "wrong", "ignore"]).toContain(v);
      }
    }
  });
  it("survives hostile numeric strings", () => {
    for (const s of ["1e999999", "9".repeat(70), "1,,,,2", "....", ",,,", "1.2.3.4.5", "10^999", "- - -", "0x10"]) {
      expect(() => match(byId("pd-001"), s)).not.toThrow();
    }
  });
});

describe("lists of guesses never pass (review probes)", () => {
  it.each([
    ["pz-016", "base ethereum polygon bitcoin"],
    ["pz-016", "Base, Polygon"],
    ["pz-010", "ethereum bitcoin solana base"],
    ["jc-006", "$41 $400 $40,000"],
    ["jc-006", "400 or 41"],
    ["eb-027", "10 30 70 99"],
    ["eb-027", "under 70%"],
    ["pd-015", "windows mac linux"],
    ["pd-015", "mac or windows"],
    ["eb-009", "nyt ft the times"],
    ["eb-009", "times of india"],
    ["eb-024", "hal finney jed mccaleb gavin"],
    ["eb-033", "satoshin@gmx.de"],
    ["eb-033", "satoshin@gmx.com.evil"],
  ])("%s: %s is not correct", (id, input) => {
    expect(verdict(id, input)).toBe("wrong");
  });

  it.each([
    ["jc-006", "it's $400"],
    ["jc-006", "I think $400"],
    ["pz-010", "the answer is ethereum"],
    ["pz-010", "ethereum!"],
    ["pz-016", "Base mainnet"],
    ["eb-027", "over 70"],
    ["pd-015", "it's mac os x"],
    ["pd-015", "the mac"],
    ["eb-009", "the times of london"],
    ["eb-009", "The Times!"],
    ["eb-024", "mccaleb jed"],
    ["eb-024", "it was jed mccaleb"],
    ["pd-004", "I think papa johns"],
    ["eb-033", "satoshin@gmx.com"],
    ["fun-002", "i think pineapple and jalapeno"],
  ])("%s: %s still passes", (id, input) => {
    expect(verdict(id, input)).toBe("correct");
  });

  it("the answer is true / articles / typos still work", () => {
    expect(verdict("pd-007", "the answer is true")).toBe("correct");
    expect(verdict("pd-004", "papa jons")).toBe("correct"); // one typo
    expect(verdict("eb-009", "a times")).toBe("correct");
  });
});

describe("strict booleans (Discord rounds)", () => {
  const tf = { answer: "true", aliases: [], rejects: [], match: { kind: "boolean" as const }, choices: undefined };
  const verdict = (raw: string, strict: boolean) => match(tf, raw, { strictBoolean: strict }).verdict;

  it("accepts only true, false, t, f and typos of true/false", () => {
    for (const w of ["true", "True", "t", "trie", "ture"]) expect(verdict(w, true)).toBe("correct");
    for (const w of ["false", "f", "flase", "fasle"]) expect(verdict(w, true)).toBe("wrong");
  });

  it("everyday chat is not an answer: yes, no, yeah, yep, nope, right, wrong, correct, y, n, thumbs", () => {
    for (const w of ["yes", "no", "yeah", "yep", "nope", "right", "wrong", "correct", "incorrect", "y", "n", "\u{1F44D}", "\u{1F44E}", "\u2705", "\u274C"]) {
      expect(verdict(w, true)).toBe("ignore");
    }
  });

  it("the web matcher is unchanged: the same words still count there", () => {
    expect(verdict("yes", false)).toBe("correct");
    expect(verdict("no", false)).toBe("wrong");
    expect(verdict("\u{1F44D}", false)).toBe("correct");
  });
});
