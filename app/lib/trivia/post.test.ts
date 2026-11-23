// @vitest-environment node
import { describe, it, expect } from "vitest";
import { servable } from "./bank";
import { questionMessage, tooLateMessage } from "./post";

const pool = await servable({ pool: "discord" });
const short = pool.find((q) => q.type === "short_answer")!;

describe("question post closing time", () => {
  const closesAt = new Date("2026-12-10T15:10:00Z");
  const unix = Math.floor(closesAt.getTime() / 1000);

  it("shows when the round closes as Discord timestamps instead of a fixed minute count", () => {
    const line = questionMessage(short, 20, undefined, closesAt).content.split("\n").pop()!;
    expect(line).toContain(`closes <t:${unix}:t> (<t:${unix}:R>)`);
    expect(line).not.toContain("10 min");
    expect(line).toContain("reports a bad question");
  });

  it("without a close time it keeps the minute count", () => {
    expect(questionMessage(short, 20).content).toContain("10 min");
  });

  it("the too-late reply names the closing time and replies to the answer without pinging", () => {
    const body = tooLateMessage(closesAt, "123");
    expect(body.content).toBe(`⌛ Too late, the round closed at <t:${unix}:t>.`);
    expect(body.message_reference).toEqual({ message_id: "123", fail_if_not_exists: false });
    expect(body.allowed_mentions).toEqual({ parse: [] });
  });
});
