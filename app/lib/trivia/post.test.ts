// @vitest-environment node
import { describe, it, expect } from "vitest";
import { servable } from "./bank";
import { bodyText } from "./test-body";
import { reveal } from "./bank";
import { FLAG_REACTION } from "./config";
import { explanationMessage, questionMessage, revealMessage, tooLateMessage } from "./post";

const pool = await servable({ pool: "discord" });
const short = pool.find((q) => q.type === "short_answer")!;

type E = { title: string; description: string; color: number; footer?: { text: string }; image?: { url: string } };
const embedOf = (b: { embeds?: unknown[] }) => b.embeds![0] as E;

describe("question post closing time", () => {
  const closesAt = new Date("2026-12-10T15:10:00Z");
  const unix = Math.floor(closesAt.getTime() / 1000);

  it("shows when the round closes as Discord timestamps instead of a fixed minute count", () => {
    const d = embedOf(questionMessage(short, 20, undefined, closesAt)).description;
    expect(d).toContain(`**⏳ Closes <t:${unix}:t> (<t:${unix}:R>)**`);
    expect(d).not.toContain("10 minutes");
  });

  it("without a close time it keeps the minute count", () => {
    expect(embedOf(questionMessage(short, 20)).description).toContain("10 minutes");
  });

  it("the too-late reply names the closing time and replies to the answer without pinging", () => {
    const body = tooLateMessage(closesAt, "123");
    expect(body.content).toBe(`⌛ Too late, the round closed at <t:${unix}:t>.`);
    expect(body.message_reference).toEqual({ message_id: "123", fail_if_not_exists: false });
    expect(body.allowed_mentions).toEqual({ parse: [] });
  });
});

describe("question embed", () => {
  const mc = pool.find((q) => q.type === "multiple_choice")!;
  const closesAt = new Date("2026-12-10T15:10:00Z");

  it("has the title, a heading question, the choices, the closes line and the footer", () => {
    const body = questionMessage(mc, 25, undefined, closesAt);
    const e = embedOf(body);
    expect(body.content).toBe("");
    expect(e.title).toBe("🎲 Trivia Time · 25 $PEP");
    expect(e.description).toContain(`### ${mc.question}`);
    mc.choices!.forEach((c, i) => expect(e.description).toContain(`${String.fromCharCode(65 + i)}.  ${c}`));
    expect(e.description).toContain("Closes <t:");
    expect(e.footer!.text).toContain("first correct answer wins");
    expect(e.footer!.text).toContain(`react ${FLAG_REACTION} to report a bad question`);
    expect(body.allowed_mentions).toEqual({ parse: [] });
  });

  it("a dry run says nothing is paid", () => {
    expect(embedOf(questionMessage(mc, 0)).title).toBe("🎲 Trivia (test round · nothing paid)");
  });

  it("never contains the explanation or a bolded answer", () => {
    for (const q of pool.slice(0, 60)) {
      const r = reveal(q);
      const text = bodyText(questionMessage(q, 20));
      expect(text).not.toContain(r.explanation);
      expect(text.toLowerCase()).not.toContain(`**${r.answer.toLowerCase()}**`);
    }
  });
});

describe("reveal and explanation embeds", () => {
  const withSource = { ...short, image: "https://example.com/photo.jpg", sources: [{ url: "https://www.example.com/page", note: "n" }] };
  const { image: _i, ...noPhoto } = withSource;

  it("reveal is amber with the answer, the explanation, a masked source link and the photo", () => {
    const body = revealMessage(withSource);
    const e = embedOf(body);
    expect(body.content).toBe("");
    expect(e.title).toBe("⏰ Time's up!");
    expect(e.description).toContain(`The answer: **${reveal(withSource).answer}**`);
    expect(e.description).toContain("Source: [example.com](https://www.example.com/page)");
    expect(e.image).toEqual({ url: "https://example.com/photo.jpg" });
    expect(body.allowed_mentions).toEqual({ parse: [] });
  });

  it("explanation is green with the answer in the title, the explanation, the source and the photo", () => {
    const e = embedOf(explanationMessage(withSource));
    expect(e.title).toBe(`✅ The answer: ${reveal(withSource).answer}`);
    expect(e.color).toBe(0x2ecc71);
    expect(e.description).toContain(reveal(withSource).explanation.slice(0, 40));
    expect(e.description).toContain("[example.com](https://www.example.com/page)");
    expect(e.image).toEqual({ url: "https://example.com/photo.jpg" });
  });

  it("sets no image when the question has no photo", () => {
    expect(embedOf(revealMessage(noPhoto)).image).toBeUndefined();
    expect(embedOf(explanationMessage(noPhoto)).image).toBeUndefined();
  });
});
