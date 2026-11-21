import { describe, expect, it } from "vitest";
// The matcher, against the MADE-UP fixture bank (the real bank is never committed). Each fixture question mirrors the
// matcher settings of a real one (number with tolerance, choice with near-miss rejects, fuzzy text, exact text...).
import raw from "./__fixtures__/questions.fixture.json";
import { QuestionSchema, type TriviaQuestion } from "./schema";
import { editDistance, fuzzyThreshold, match, parseNumbers, parseBoolean, parseChoiceLetter } from "./match";

const bank = { questions: raw.questions.map((q) => QuestionSchema.parse(q)) };
const byId = (id: string): TriviaQuestion => {
  const q = bank.questions.find((x) => x.id === id);
  if (!q) throw new Error(`no question ${id}`);
  return q;
};
const verdict = (id: string, input: string) => match(byId(id), input).verdict;
const approved = bank.questions.filter((q) => q.status === "approved");

describe("bank-driven: every approved fixture question", () => {
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
    expect(verdict("pd-902", "Trie")).toBe("correct");
    expect(verdict("pd-902", "True")).toBe("correct");
  });
  it.each(["true", "TRUE", "t", "yes", "y", "yep", "yeah", "correct", "right", "✅", "\u{1F44D}", "ture", "trie", "it's true", "I think true", "**true**", "true!", "answer: true"])(
    "accepts %s as true",
    (s) => expect(parseBoolean(s)).toBe(true),
  );
  it.each(["false", "f", "no", "n", "nope", "wrong", "incorrect", "❌", "\u{1F44E}", "flase", "fasle", "fales"])("accepts %s as false", (s) =>
    expect(parseBoolean(s)).toBe(false),
  );
  it.each(["maybe", "lol", "hello there", "tr", "trash", "idk"])("%s is not an answer (ignore)", (s) => {
    expect(verdict("pd-902", s)).toBe("ignore");
  });
  it("a wrong boolean is wrong, not ignored", () => {
    expect(verdict("pd-903", "true")).toBe("wrong"); // pd-903 is false
    expect(verdict("pd-903", "flase")).toBe("correct");
  });
});

describe("numbers", () => {
  it.each([
    ["0.00649", [[0.00649]]],
    ["0.0001", [[0.0001]]],
    [".5", [[0.5]]],
    ["0.1", [[0.1]]],
    ["1.0065", [[1.0065]]],
    ["it is 0.00649 exactly", [[0.00649]]],
    ["1,000", [[1000]]],
    ["10,000.5", [[10000.5]]],
    ["2,048", [[2048]]],
    ["between 0.0123 and 5,000", [[0.0123], [5000]]],
  ])("parseNumbers(%j) reads %j", (input, expected) => {
    expect(parseNumbers(input)).toEqual(expected);
  });
  it("9,900 / 9900 / 9 900 / 9.9k all read as 9900", () => {
    for (const s of ["9,900", "9900", "9 900", "9.9k"]) expect(parseNumbers(s).flat()).toContain(9900);
  });
  it("10.000 reads as ten thousand (and as 10: both readings are offered)", () => {
    expect(parseNumbers("10.000")[0]).toContain(10000);
    expect(verdict("pd-901", "10.000")).toBe("correct");
  });
  it("0.99 is not 99", () => {
    expect(verdict("pd-904", "0.99")).toBe("correct");
    expect(verdict("pd-904", ".99")).toBe("correct");
    expect(verdict("pd-904", "99")).toBe("wrong");
    expect(parseNumbers("0.99")[0]).toEqual([0.99]);
  });
  it("3.125 is a decimal (the flour question)", () => {
    expect(verdict("pr-904", "3.125")).toBe("correct");
    expect(verdict("pr-904", "6.25")).toBe("wrong");
  });
  it("never fuzzy on digits", () => {
    expect(verdict("pd-901", "9,800")).toBe("wrong");
    expect(verdict("pd-901", "10001")).toBe("wrong");
    expect(verdict("pd-909", "48122")).toBe("wrong");
  });
  it("suffixes, words and exponents", () => {
    expect(verdict("pd-901", "10k")).toBe("correct");
    expect(verdict("pd-901", "ten thousand")).toBe("correct");
    expect(verdict("pd-901", "10,000 olives")).toBe("correct");
    expect(verdict("pr-909", "1e8")).toBe("correct");
    expect(verdict("pr-909", "10^8")).toBe("correct");
    expect(verdict("pr-909", "one hundred million")).toBe("correct");
    expect(verdict("pr-909", "100 million")).toBe("correct");
    expect(verdict("eb-904", "nine")).toBe("correct");
    expect(verdict("pr-901", "$50")).toBe("correct");
  });
  it("273 billion passes eb-920 (tolerance), 27 million fails", () => {
    expect(verdict("eb-920", "273 billion")).toBe("correct");
    expect(verdict("eb-920", "273,400,000,000")).toBe("correct");
    expect(verdict("eb-920", "136 billion")).toBe("wrong");
    expect(verdict("eb-920", "27 million")).toBe("wrong");
  });
  it("no number, or several, is not an attempt", () => {
    expect(verdict("pd-901", "no idea")).toBe("ignore");
    expect(verdict("pd-901", "10000 or 20000")).toBe("ignore");
    expect(verdict("pd-901", "lol")).toBe("ignore");
  });
  it("percent and dates", () => {
    expect(verdict("pz-906", "51%")).toBe("correct");
    expect(verdict("pz-906", "49")).toBe("wrong");
    expect(verdict("pd-910", "1987")).toBe("correct");
    expect(verdict("pd-910", "1988")).toBe("wrong");
  });
});

describe("text", () => {
  it("rejects beat fuzzy and aliases", () => {
    expect(verdict("pd-905", "crust corner's")).toBe("wrong");
    expect(verdict("pd-905", "crust corners")).toBe("wrong");
    expect(verdict("pd-905", "Slice Shack's")).toBe("correct");
    expect(verdict("pd-905", "slice shacks")).toBe("correct");
  });
  it("negation blocks containment", () => {
    expect(verdict("eb-913", "not marla crust")).toBe("wrong");
  });
  it("plain mango does not count for fun-902, mango jalapeno does", () => {
    expect(verdict("fun-902", "mango")).toBe("wrong");
    expect(verdict("fun-902", "Mango Jalapeño")).toBe("correct");
    expect(verdict("fun-902", "mango and jalapenos")).toBe("correct");
    expect(verdict("fun-902", "mango jalapneo")).toBe("correct"); // typo, fuzzy
  });
  it("a wrong text guess is wrong", () => {
    expect(verdict("fun-902", "pepperoni")).toBe("wrong");
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
    expect(verdict("fun-902", "||MANGO jalapeño||")).toBe("correct");
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
    expect(verdict("pd-905", "lol no idea")).toBe("ignore");
    expect(verdict("pd-905", "e")).toBe("ignore");
  });
  it("naming another choice is wrong", () => {
    expect(verdict("pd-905", "Oven Owls")).toBe("wrong");
    expect(verdict("pd-905", "slice shacks pizza")).toBe("correct");
  });
});

describe("pre-filter", () => {
  const q = () => byId("pd-901");
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
      expect(() => match(byId("pd-901"), s)).not.toThrow();
    }
  });
});

describe("lists of guesses never pass (review probes)", () => {
  it.each([
    ["pz-916", "oven grill smoker fryer"],
    ["pz-916", "Oven, Smoker"],
    ["pz-910", "basil oregano thyme parsley"],
    ["jc-906", "$12 $120 $12,000"],
    ["jc-906", "120 or 12"],
    ["eb-927", "5 25 60 95"],
    ["eb-927", "under 60%"],
    ["pd-915", "gas brick electric"],
    ["pd-915", "brick or gas"],
    ["eb-909", "nyg dg the gazette"],
    ["eb-909", "gazette of india"],
    ["eb-924", "marla crust rita calzone tony"],
    ["eb-933", "chef@fixture.de"],
    ["eb-933", "chef@fixture.test.evil"],
  ])("%s: %s is not correct", (id, input) => {
    expect(verdict(id, input)).toBe("wrong");
  });

  it.each([
    ["jc-906", "it's $120"],
    ["jc-906", "I think $120"],
    ["pz-910", "the answer is basil"],
    ["pz-910", "basil!"],
    ["pz-916", "Oven door"],
    ["eb-927", "over 60"],
    ["pd-915", "it's brick oven deluxe"],
    ["pd-915", "the brick"],
    ["eb-909", "the gazette of fixture"],
    ["eb-909", "The Gazette!"],
    ["eb-924", "calzone rita"],
    ["eb-924", "it was rita calzone"],
    ["pd-905", "I think slice shacks"],
    ["eb-933", "chef@fixture.test"],
    ["fun-902", "i think mango and jalapeno"],
  ])("%s: %s still passes", (id, input) => {
    expect(verdict(id, input)).toBe("correct");
  });

  it("the answer is true / articles / typos still work", () => {
    expect(verdict("pd-902", "the answer is true")).toBe("correct");
    expect(verdict("pd-905", "slice shaks")).toBe("correct"); // one typo
    expect(verdict("eb-909", "a gazette")).toBe("correct");
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

describe("text answers: chat sentences are ignored, short misses are wrong attempts", () => {
  const q = { answer: "Marla Crust", aliases: ["Marla"], rejects: [], match: { kind: "text" as const, fuzzy: true }, choices: undefined };
  it("a long sentence that matches nothing is not an attempt", () => {
    expect(match(q, "hey everyone how is the call going today friends").verdict).toBe("ignore");
    expect(match(q, "does anyone know when the next call starts tonight").verdict).toBe("ignore");
  });
  it("a short wrong guess is still an attempt", () => {
    expect(match(q, "Rita Calzone").verdict).toBe("wrong");
    expect(match(q, "tony").verdict).toBe("wrong");
  });
  it("a correct answer inside a longer sentence still counts", () => {
    expect(match(q, "i think it was marla crust").verdict).toBe("correct");
  });
});
