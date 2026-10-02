import { describe, it, expect } from "vitest";
import {
  buildCommunityCallMessages,
  escapeDiscordLinkText,
  formatSheetTimestamp,
  normalizeForCrossPosting,
  parseHyperlinkFormula,
  parseSheetTimestamp,
  renderSpecials,
  upcomingSundayLabel,
} from "./message";

const TZ = "America/New_York";

describe("announce message helpers", () => {
  it("renders only To Do / Redo rows with crew emoji and masked links", () => {
    const lines = renderSpecials([
      { text: "Ops goals", url: null, crew: "Ops", status: "To Do" },
      { text: "Hack [beta]", url: "https://x.test/h", crew: "tech", status: "redo" },
      { text: "Old thing", url: null, crew: "Ops", status: "Done" },
      { text: "No crew", url: null, crew: "", status: "to do" },
      { text: "", url: null, crew: "Ops", status: "To Do" },
    ]);
    expect(lines).toEqual([
      "🫡 Ops goals",
      "💻 [Hack \\[beta\\]](https://x.test/h)",
      "🍕 No crew",
    ]);
  });

  it("escapes Discord link text", () => {
    expect(escapeDiscordLinkText("a\\b[c](d)")).toBe("a\\\\b\\[c\\]\\(d\\)");
  });

  it("parses HYPERLINK formulas", () => {
    expect(parseHyperlinkFormula('=HYPERLINK("https://a.test/x", "Label")')).toBe("https://a.test/x");
    expect(parseHyperlinkFormula("=SUM(A1:A2)")).toBeNull();
    expect(parseHyperlinkFormula(null)).toBeNull();
  });

  it("labels the upcoming Sunday in the given zone (today if Sunday)", () => {
    // Fri 2026-10-02 18:00 UTC -> Sunday, October 4
    expect(upcomingSundayLabel(new Date("2026-10-02T18:00:00Z"), TZ)).toBe("Sunday, October 4");
    // Sun 2026-10-04 15:00 UTC (11am ET) -> same day
    expect(upcomingSundayLabel(new Date("2026-10-04T15:00:00Z"), TZ)).toBe("Sunday, October 4");
    // Mon 2026-10-05 02:00 UTC is still Sunday evening in New York
    expect(upcomingSundayLabel(new Date("2026-10-05T02:00:00Z"), TZ)).toBe("Sunday, October 4");
  });

  it("formats and parses sheet timestamps in the zone", () => {
    const d = new Date("2026-08-08T19:49:51Z");
    expect(formatSheetTimestamp(d, TZ)).toBe("2026-08-08 15:49:51");
    expect(parseSheetTimestamp("2026-08-08 15:49:51", TZ)?.toISOString()).toBe("2026-08-08T19:49:51.000Z");
    expect(parseSheetTimestamp("not a date", TZ)).toBeNull();
  });

  it("builds the Discord and Telegram messages", () => {
    const { discord, telegram, specialsCount } = buildCommunityCallMessages(
      [{ text: "Ops goals", url: null, crew: "ops", status: "To Do" }],
      new Date("2026-10-02T18:00:00Z"),
      TZ,
    );
    expect(specialsCount).toBe(1);
    expect(discord).toContain("Community Call Sunday, October 4 on Pizza Hacking Radio!");
    expect(discord).toContain("🫡 Ops goals");
    expect(discord).toContain("https://discord.com/events/");
    expect(discord.trim().endsWith("@everyone  @here")).toBe(true);
    expect(discord.length).toBeLessThan(2000);
    expect(telegram).toContain("Community Call Sunday, October 4 on https://discord.pizzadao.xyz");
    expect(telegram).not.toContain("@everyone");
  });

  it("falls back to a placeholder when there are no specials", () => {
    const { discord, specialsCount } = buildCommunityCallMessages([], new Date("2026-10-02T18:00:00Z"), TZ);
    expect(specialsCount).toBe(0);
    expect(discord).toContain('No "to do" / "redo" specials');
  });

  it("normalizes whitespace for cross-posting", () => {
    expect(normalizeForCrossPosting("a  b  \r\nc﻿")).toBe("a b\nc");
  });
});
