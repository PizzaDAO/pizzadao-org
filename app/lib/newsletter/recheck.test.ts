// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/db", () => ({ prisma: {} }));

import { EMPTY_POST_FILTER, type PostFilter } from "@/app/lib/calls/post-filters";
import { recheckContent, visibleTexts, type RecheckCall } from "./recheck";
import { emptySections } from "./sections";

const sections = () => {
  const s = emptySections();
  s.intro = "Hello.";
  s.calls = {
    enabled: true,
    intro: "",
    crews: [
      { id: "ops", label: "Ops Crew", summary: "Reviewed the backlog.", bullets: ["Reviewed the backlog."], shipped: ["Shipped the guide"], url: "", included: true },
      { id: "off", label: "Off Crew", summary: "Not in the issue.", bullets: [], shipped: [], url: "", included: false },
    ],
  };
  return s;
};
const call = (o: Partial<RecheckCall> = {}): RecheckCall => ({ id: "c1", status: "PUBLISHED", source: "DISCORD", crewId: "ops", crewLabel: "Ops Crew", ...o });
const run = (o: { sections?: ReturnType<typeof sections>; filter?: PostFilter; calls?: RecheckCall[]; callIds?: string[]; importedOk?: boolean; subject?: string } = {}) =>
  recheckContent({ subject: o.subject ?? "Subject", preheader: "", sections: o.sections ?? sections(), callIds: o.callIds ?? ["c1"] }, o.filter ?? EMPTY_POST_FILTER, o.calls ?? [call()], o.importedOk ?? false);

describe("approval-time re-check", () => {
  it("passes unchanged content", () => {
    expect(run()).toEqual([]);
  });

  it("flags a call that is no longer published", () => {
    expect(run({ calls: [call({ status: "REVIEW" })] }).join(" ")).toMatch(/no longer published/);
  });

  it("flags a call that was deleted", () => {
    expect(run({ calls: [] }).join(" ")).toMatch(/no longer exists/);
  });

  it("flags redactions newer than the summary", () => {
    const stale = call({ redactionsUpdatedAt: new Date("2026-12-11"), summaryGeneratedAt: new Date("2026-12-10") });
    expect(run({ calls: [stale] }).join(" ")).toMatch(/newer redactions/);
  });

  it("flags a crew excluded since drafting (by section or by call)", () => {
    const filter: PostFilter = { excludedCrewIds: ["ops"], excludedCrewLabelTerms: [], blockedTerms: [] };
    const problems = run({ filter });
    expect(problems.join(" ")).toMatch(/excluded/);
  });

  it("flags imported calls when they are no longer allowed", () => {
    expect(run({ calls: [call({ source: "X_SPACE" })] }).join(" ")).toMatch(/imported/);
    expect(run({ calls: [call({ source: "X_SPACE" })], importedOk: true })).toEqual([]);
  });

  it("ignores problems with crews that are unticked", () => {
    const s = sections();
    s.calls.crews[0]!.included = false;
    expect(run({ sections: s, calls: [call({ status: "REVIEW" })] })).toEqual([]);
  });

  it("re-applies blocked terms to call text, labels and model-written text without echoing the term", () => {
    const filter: PostFilter = { excludedCrewIds: [], excludedCrewLabelTerms: [], blockedTerms: ["secretword"] };
    const s = sections();
    s.calls.crews[0]!.summary = "The secretword project.";
    s.intro = "A secretword intro.";
    const problems = run({ sections: s, filter, subject: "About secretword" });
    expect(problems.join(" ")).toMatch(/Call updates \(Ops Crew\)/);
    expect(problems.join(" ")).toMatch(/opening/);
    expect(problems.join(" ")).toMatch(/subject/);
    expect(problems.join(" ")).not.toContain("secretword");
  });

  it("does not scan unticked items or disabled sections", () => {
    const filter: PostFilter = { excludedCrewIds: [], excludedCrewLabelTerms: [], blockedTerms: ["secretword"] };
    const s = sections();
    s.calls.crews[1]!.summary = "secretword";
    s.articles = { enabled: false, intro: "secretword", items: [] };
    expect(visibleTexts("S", "", s).some((t) => t.text.includes("secretword"))).toBe(false);
    expect(run({ sections: s, filter })).toEqual([]);
  });
});
