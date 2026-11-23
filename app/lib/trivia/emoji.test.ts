// @vitest-environment node
import { describe, it, expect } from "vitest";
import { buildChoiceLabels, emojiToReaction, judgeReaction, reactionBoolean, reactionChoiceIndex, reactionsFor } from "./emoji";
import { questionMessage } from "./post";
import { bodyText } from "./test-body";
import { CHOICE_EMOJI, CHOICE_FALLBACK, FLAG_REACTION, TF_REACTIONS, reactionAttemptKey } from "./config";
import { getBank } from "./bank";
import type { TriviaQuestion } from "./schema";

const bank = (await getBank()).questions;
const mc = bank.find((q) => q.id === "jc-906")!; // $120, 4 choices
const tf = bank.find((q) => q.type === "true_false" && q.status === "approved")!;
const short = bank.find((q) => q.type === "short_answer" && q.status === "approved")!;
const ALL = new Set(CHOICE_EMOJI.map((e) => e.id));
const turtle = (i: number) => ({ id: CHOICE_EMOJI[i].id, name: CHOICE_EMOJI[i].name });

describe("config: the turtle mapping (theme-song order)", () => {
  it("A = Leonardo, B = Donatello, C = Raphael, D = Michelangelo, with the guild's ids", () => {
    expect(CHOICE_EMOJI.map((e) => `${e.name}:${e.id}`)).toEqual([
      "1_leonardo:814002498066710559",
      "1_donatello:814002525736796211",
      "1_raphael:814002564743692289",
      "1_michelangelo:814002543046688775",
    ]);
  });
});

describe("buildChoiceLabels", () => {
  it("uses the turtles (custom emoji syntax) when all of them exist", () => {
    const l = buildChoiceLabels(4, ALL);
    expect(l.fallback).toBe(false);
    expect(l.display).toEqual(["<:1_leonardo:814002498066710559>", "<:1_donatello:814002525736796211>", "<:1_raphael:814002564743692289>", "<:1_michelangelo:814002543046688775>"]);
    expect(l.reactions).toEqual(["1_leonardo:814002498066710559", "1_donatello:814002525736796211", "1_raphael:814002564743692289", "1_michelangelo:814002543046688775"]);
  });

  it("only needs the turtles it uses: 3 choices need Leonardo, Donatello and Raphael", () => {
    const l = buildChoiceLabels(3, new Set([CHOICE_EMOJI[0].id, CHOICE_EMOJI[1].id, CHOICE_EMOJI[2].id]));
    expect(l.fallback).toBe(false);
    expect(l.display).toHaveLength(3);
  });

  it("falls back to the regional indicators for the whole round when one turtle is missing", () => {
    const without = new Set(ALL);
    without.delete(CHOICE_EMOJI[2].id);
    const l = buildChoiceLabels(4, without);
    expect(l.fallback).toBe(true);
    expect(l.display).toEqual([...CHOICE_FALLBACK]);
    expect(l.reactions).toEqual([...CHOICE_FALLBACK]);
  });

  it("falls back when the guild's emoji could not be read (we cannot tell)", () => {
    expect(buildChoiceLabels(4, null).fallback).toBe(true);
  });
});

describe("reactionsFor", () => {
  it("true/false pre-adds the check, the cross, then the flag", () => {
    expect(reactionsFor(tf, buildChoiceLabels(0, null))).toEqual([TF_REACTIONS.true, TF_REACTIONS.false, FLAG_REACTION]);
  });
  it("multiple choice pre-adds one reaction per choice in order, then the flag last", () => {
    expect(reactionsFor(mc, buildChoiceLabels(4, ALL))).toEqual([...buildChoiceLabels(4, ALL).reactions, FLAG_REACTION]);
    expect(reactionsFor({ type: "multiple_choice", choices: ["a", "b", "c"] }, buildChoiceLabels(3, ALL))).toHaveLength(4);
  });
  it("short answers get only the flag; every question ends with it", () => {
    expect(reactionsFor(short, buildChoiceLabels(0, null))).toEqual([FLAG_REACTION]);
    for (const q of [tf, mc, short]) expect(reactionsFor(q, buildChoiceLabels(4, ALL)).at(-1)).toBe(FLAG_REACTION);
  });
});

describe("reaction -> choice mapping", () => {
  it("each turtle picks its position: A, B, C, D", () => {
    for (let i = 0; i < 4; i++) expect(reactionChoiceIndex(turtle(i), 4)).toBe(i);
  });

  it("the regional indicators pick the same positions (the fallback round)", () => {
    CHOICE_FALLBACK.forEach((c, i) => expect(reactionChoiceIndex({ id: null, name: c }, 4)).toBe(i));
  });

  it("a position beyond the question's choices, another custom emoji and a plain emoji are not picks", () => {
    expect(reactionChoiceIndex(turtle(3), 3)).toBeNull();
    expect(reactionChoiceIndex({ id: "999999999999999999", name: "1_leonardo" }, 4)).toBeNull();
    expect(reactionChoiceIndex({ id: null, name: "\u{1F355}" }, 4)).toBeNull();
    expect(reactionChoiceIndex({ id: null, name: null }, 4)).toBeNull();
  });

  it("judges a multiple-choice pick against the answer's position", () => {
    const right = mc.choices!.indexOf(mc.answer);
    for (let i = 0; i < 4; i++) {
      expect(judgeReaction(mc, turtle(i))).toEqual({ correct: i === right, label: String.fromCharCode(65 + i) });
    }
  });

  it("judges true/false: the check is true, the cross is false, with or without a variation selector", () => {
    const t = tf.answer === "true";
    expect(judgeReaction(tf, { id: null, name: "✅" })).toEqual({ correct: t, label: "true" });
    expect(judgeReaction(tf, { id: null, name: "❌" })).toEqual({ correct: !t, label: "false" });
    expect(judgeReaction(tf, { id: null, name: "❌️" })).toEqual({ correct: !t, label: "false" });
    expect(reactionBoolean({ id: null, name: "\u{1F44D}" })).toBeNull();
  });

  it("a turtle on a true/false question, a check on a multiple-choice question, or any reaction on a short answer is not a pick", () => {
    expect(judgeReaction(tf, turtle(0))).toBeNull();
    expect(judgeReaction(mc, { id: null, name: "✅" })).toBeNull();
    expect(judgeReaction(short, turtle(0))).toBeNull();
    expect(judgeReaction(short, { id: null, name: "✅" })).toBeNull();
  });

  it("emojiToReaction gives the REST form", () => {
    expect(emojiToReaction(turtle(2))).toBe("1_raphael:814002564743692289");
    expect(emojiToReaction({ id: null, name: "✅" })).toBe("✅");
    expect(emojiToReaction({ id: "1", name: null })).toBeNull();
  });

  it("the attempt key is per question message and member", () => {
    expect(reactionAttemptKey("111", "222")).toBe("reaction:111:222");
  });
});

describe("question post with the turtles", () => {
  const labels = buildChoiceLabels(4, ALL);

  it("multiple choice: each choice is prefixed by its turtle instead of A-D, and says to react or type", () => {
    const body = questionMessage(mc, 20, labels);
    const lines = bodyText(body).split("\n");
    mc.choices!.forEach((c, i) => expect(lines).toContain(`${labels.display[i]}  ${c}`));
    expect(bodyText(body)).not.toMatch(/\u{1F170}|\u{1F171}/u);
    expect(bodyText(body)).toContain("React with your pick, or type the answer");
    expect(bodyText(body)).not.toMatch(/type its letter|\(A\)|\bA\.\s/);
    expect(body.allowed_mentions).toEqual({ parse: [] });
  });

  it("multiple choice in the fallback round shows the regional indicators", () => {
    const f = buildChoiceLabels(4, null);
    expect(bodyText(questionMessage(mc, 20, f))).toContain(`${CHOICE_FALLBACK[0]}  ${mc.choices![0]}`);
  });

  it("with no labels (a caller that has none) it still shows plain letters", () => {
    expect(bodyText(questionMessage(mc, 20))).toContain(`A.  ${mc.choices![0]}`);
  });

  it("true/false says to react with the check or the cross (or type)", () => {
    const body = questionMessage(tf, 20);
    expect(bodyText(body)).toContain("React ✅ or ❌, or type true / false");
    expect(bodyText(body)).toContain("True or false");
  });

  it("short answers are unchanged: no reaction hint", () => {
    expect((questionMessage(short, 20).embeds![0] as { description: string }).description).not.toContain("React");
  });

  it("every post says the flag reports a bad question", () => {
    for (const q of [tf, mc, short]) expect(bodyText(questionMessage(q, 20, labels))).toContain(`${FLAG_REACTION} to report a bad question`);
  });

  it("a dry run still says nothing is paid", () => {
    expect(bodyText(questionMessage(mc, 0, labels))).toContain("nothing paid");
  });

  it("stays well under Discord's limit for the longest bank question", () => {
    for (const q of bank.filter((x) => x.status === "approved") as TriviaQuestion[]) {
      expect(bodyText(questionMessage(q, 20, buildChoiceLabels(q.choices?.length ?? 0, ALL))).length).toBeLessThan(4000);
    }
  });
});
