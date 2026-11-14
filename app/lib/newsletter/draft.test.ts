// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/db", () => ({ prisma: {} }));

import { applyDraftText, draftModel, draftPrompt, draftSystemPrompt, writeDraftText, type DraftOutput } from "./draft";
import { emptySections } from "./sections";
import { fakeSettings } from "./fake-db";

const sections = () => {
  const s = emptySections();
  s.calls = {
    enabled: true,
    intro: "",
    crews: [
      { id: "ops", label: "Ops Crew", summary: "raw", bullets: ["Reviewed the backlog."], shipped: ["Shipped the guide"], url: "https://app.example.org/calls/c1", included: true },
      { id: "gone", label: "Hidden Crew", summary: "raw", bullets: ["Hidden bullet."], shipped: [], url: "", included: false },
    ],
  };
  s.member = { enabled: true, submissionId: 1, name: "Nominee", city: "Town", blurb: "Did good things.", links: [], photoUrl: "" };
  return s;
};
const out = (o: Partial<DraftOutput> = {}): DraftOutput => ({
  subject: "December news",
  preheader: "What happened",
  intro: "Welcome to the issue.",
  crews: [{ id: "ops", summary: "Ops condensed." }, { id: "unknown", summary: "ignored" }],
  memberBlurb: "A polished blurb.",
  cityBlurb: "Should not apply",
  partnerBlurb: null,
  articlesIntro: "ignored too",
  eventsIntro: null,
  ...o,
});

describe("newsletter draft (model mocked)", () => {
  it("only shows the model filtered, included data", () => {
    const prompt = draftPrompt(sections(), "December 2026");
    expect(prompt).toContain("Reviewed the backlog.");
    expect(prompt).toContain("Shipped the guide");
    expect(prompt).not.toContain("Hidden bullet");
    expect(prompt).not.toMatch(/transcript/i);
  });

  it("folds the model text into existing sections only", () => {
    const next = applyDraftText(sections(), out());
    expect(next.intro).toBe("Welcome to the issue.");
    expect(next.calls.crews.find((c) => c.id === "ops")!.summary).toBe("Ops condensed.");
    expect(next.calls.crews.find((c) => c.id === "gone")!.summary).toBe("raw");
    expect(next.member.blurb).toBe("A polished blurb.");
    expect(next.city.blurb).toBe(""); // section absent: untouched
    expect(next.articles.intro).toBe("");
  });

  it("calls the model with the settings' model and instructions and returns subject, preheader and sections", async () => {
    const generate = vi.fn(async () => out());
    const settings = fakeSettings({ "newsletter.draftModel": "provider/custom", "newsletter.promptExtra": "PRIVATE-RULE" });
    const res = await writeDraftText(sections(), "December 2026", { settings: settings as never, generate: generate as never });
    expect(generate).toHaveBeenCalledTimes(1);
    const arg = (generate.mock.calls[0] as unknown as [{ model: string; system: string; prompt: string }])[0];
    expect(arg.model).toBe("provider/custom");
    expect(arg.system).toContain("PRIVATE-RULE");
    expect(res).toMatchObject({ subject: "December news", preheader: "What happened", model: "provider/custom" });
    expect(res.sections.intro).toBe("Welcome to the issue.");
  });

  it("falls back to the summary model when no draft model is set", () => {
    expect(draftModel(fakeSettings() as never, {})).toBe("anthropic/claude-sonnet-5.5");
    expect(draftModel(fakeSettings() as never, { CALL_SUMMARY_MODEL: "x/y" })).toBe("x/y");
  });

  it("fails closed when settings cannot be read (never drafts without the private instructions)", async () => {
    const generate = vi.fn();
    const broken = { ...fakeSettings(), readFailed: true };
    await expect(writeDraftText(sections(), "December 2026", { settings: broken as never, generate: generate as never })).rejects.toThrow(/unreadable/);
    const invalid = { ...fakeSettings(), invalidKeys: ["newsletter.promptExtra"] };
    expect(() => draftSystemPrompt(invalid as never)).toThrow(/unreadable/);
    expect(generate).not.toHaveBeenCalled();
  });
});
