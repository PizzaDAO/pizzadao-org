// @vitest-environment node
import { describe, expect, it } from "vitest";
import { getBank } from "./bank";
import { shareEmojiLine, shareValues } from "./share";
import en from "@/messages/en.json";

describe("share text", () => {
  it("is a pizza and a tick or a cross, with the streak from 2 days", () => {
    expect(shareEmojiLine(true, 0)).toBe("🍕✅");
    expect(shareEmojiLine(true, 1)).toBe("🍕✅");
    expect(shareEmojiLine(false, 5)).toBe("🍕❌ 🔥5");
    expect(shareEmojiLine(true, null)).toBe("🍕✅");
  });

  it("carries only the day, the emoji line and the link: never the question or the answer", () => {
    const v = shareValues({ dayKey: "2026-11-20", correct: true, streak: 3, url: "https://pizzadao.org/trivia" });
    expect(v).toEqual({ date: "2026-11-20", emojis: "🍕✅ 🔥3", url: "https://pizzadao.org/trivia" });
    const text = en.trivia.shareText.replace("{date}", v.date).replace("{emojis}", v.emojis).replace("{url}", v.url);
    expect(text.split("\n")).toEqual(["Pizza Trivia 2026-11-20", "🍕✅ 🔥3", "Play: https://pizzadao.org/trivia"]);
    for (const q of getBank().questions.filter((x) => x.answer.length > 5)) expect(text.toLowerCase()).not.toContain(q.answer.toLowerCase());
  });
});
