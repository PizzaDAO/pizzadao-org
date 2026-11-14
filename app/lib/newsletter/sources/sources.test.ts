// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/db", () => ({ prisma: {} }));
vi.mock("@/app/lib/call-updates/sources", async (orig) => ({ ...(await orig<typeof import("@/app/lib/call-updates/sources")>()), taskChangesSince: vi.fn() }));

import { EMPTY_POST_FILTER, type PostFilter } from "@/app/lib/calls/post-filters";
import { DEFAULT_RECAP_LIMITS } from "@/app/lib/calls/recap";
import { plainLine, selectCallUpdates, shippedItems, skipReason, type CallRow } from "./calls";
import { articleExcerpt, selectArticles, stripMarkdown, type ArticleRow } from "./articles";
import { selectEvents } from "./events";
import { citySection, cityOptions, eligibleSpotlights, memberCandidates, memberSection, type SpotlightRow } from "./spotlight";

const T = (s: string) => new Date(s);
const call = (o: Partial<CallRow> = {}): CallRow => ({
  id: "c1",
  source: "DISCORD",
  crewId: "ops",
  crewLabel: "Ops Crew",
  summary: "The crew reviewed the backlog. They agreed on a new triage order. A volunteer will draft the guide. Next week is planning.",
  actionItems: [],
  chapters: [],
  publishedAt: T("2026-12-10T10:00:00Z"),
  ...o,
});
const opts = (o: Partial<Parameters<typeof selectCallUpdates>[1]> = {}) => ({
  filter: EMPTY_POST_FILTER,
  importedOk: false,
  ownerNames: true,
  maxCrews: 8,
  limits: DEFAULT_RECAP_LIMITS,
  base: "https://app.example.org",
  ...o,
});

describe("call updates selection", () => {
  it("groups calls per crew with bullets and a recap link", () => {
    const out = selectCallUpdates([call(), call({ id: "c2", publishedAt: T("2026-12-12T10:00:00Z") })], opts());
    expect(out.crews).toHaveLength(1);
    expect(out.crews[0]).toMatchObject({ id: "ops", label: "Ops Crew", included: true, url: "https://app.example.org/calls/c2" });
    expect(out.crews[0]!.bullets.length).toBeGreaterThan(0);
    expect(out.callIds.sort()).toEqual(["c1", "c2"]);
  });

  it("drops excluded crews and blocked terms", () => {
    const filter: PostFilter = { excludedCrewIds: ["secret"], excludedCrewLabelTerms: [], blockedTerms: ["triage"] };
    const out = selectCallUpdates([call({ id: "x", crewId: "secret", crewLabel: "Secret" }), call()], opts({ filter }));
    expect(out.crews.map((c) => c.id)).toEqual(["ops"]);
    expect(out.crews[0]!.bullets.join(" ")).not.toMatch(/triage/);
  });

  it("skips imported calls unless allowed, and calls whose redactions are newer than the summary", () => {
    const imported = call({ id: "i", crewId: "imp", source: "X_SPACE" });
    expect(skipReason(imported, opts())).toBe("imported");
    expect(selectCallUpdates([imported], opts()).crews).toHaveLength(0);
    expect(selectCallUpdates([imported], opts({ importedOk: true })).crews).toHaveLength(1);
    const stale = call({ id: "s", redactionsUpdatedAt: T("2026-12-11T00:00:00Z"), summaryGeneratedAt: T("2026-12-10T00:00:00Z") });
    expect(skipReason(stale, opts())).toBe("stale-redactions");
    expect(selectCallUpdates([stale], opts()).crews).toHaveLength(0);
    const fresh = call({ redactionsUpdatedAt: T("2026-12-09T00:00:00Z"), summaryGeneratedAt: T("2026-12-10T00:00:00Z") });
    expect(skipReason(fresh, opts())).toBeNull();
  });

  it("keeps only done action items, filters them, and names owners only when allowed", () => {
    const items = [
      { text: "Ship the guide", owner: "Alex", done: true },
      { text: "Not done yet", owner: "Sam", done: false },
      { text: "Ask about triage budget", owner: null, done: true },
    ];
    const filter: PostFilter = { excludedCrewIds: [], excludedCrewLabelTerms: [], blockedTerms: ["budget"] };
    expect(shippedItems(items, filter, true)).toEqual(["Ship the guide (Alex)"]);
    expect(shippedItems(items, filter, false)).toEqual(["Ship the guide"]);
  });

  it("neutralises Discord mentions and markup", () => {
    expect(plainLine("**Thanks** <@123456789012345678> and <@&987654321098765432> `code`")).toBe("Thanks @user and @user code");
  });

  it("caps the number of crews, most calls first", () => {
    const rows = [call({ id: "a1", crewId: "a" }), call({ id: "b1", crewId: "b" }), call({ id: "b2", crewId: "b" })];
    const out = selectCallUpdates(rows, opts({ maxCrews: 1 }));
    expect(out.crews.map((c) => c.id)).toEqual(["b"]);
    expect(out.callIds.sort()).toEqual(["b1", "b2"]);
  });
});

const art = (o: Partial<ArticleRow> = {}): ArticleRow => ({
  id: 1,
  slug: "hello-world",
  title: "Hello",
  excerpt: null,
  content: "# Heading\n\nSome **bold** text with a [link](https://example.org) and more.",
  coverImage: null,
  authorName: "Writer",
  publishedAt: T("2026-12-05T00:00:00Z"),
  ...o,
});

describe("new articles", () => {
  const since = T("2026-12-01T00:00:00Z");
  const until = T("2026-12-20T00:00:00Z");

  it("takes only articles inside the window, newest first, capped", () => {
    const rows = [
      art({ id: 1, publishedAt: T("2026-11-30T00:00:00Z") }), // before
      art({ id: 2, slug: "two", publishedAt: T("2026-12-03T00:00:00Z") }),
      art({ id: 3, slug: "three", publishedAt: T("2026-12-09T00:00:00Z") }),
      art({ id: 4, slug: "four", publishedAt: T("2026-12-21T00:00:00Z") }), // after
      art({ id: 5, slug: "five", publishedAt: null }),
    ];
    expect(selectArticles(rows, since, until, 5, "https://app.example.org").map((a) => a.id)).toEqual(["3", "2"]);
    expect(selectArticles(rows, since, until, 1).map((a) => a.id)).toEqual(["3"]);
  });

  it("is empty (section omitted) when nothing was published", () => {
    expect(selectArticles([art({ publishedAt: T("2026-11-01T00:00:00Z") })], since, until, 5)).toEqual([]);
    expect(selectArticles([], since, until, 5)).toEqual([]);
  });

  it("links to /articles/<slug> and uses the article's own excerpt as is", () => {
    const [a] = selectArticles([art({ excerpt: "Own excerpt." })], since, until, 5, "https://app.example.org/");
    expect(a).toMatchObject({ url: "https://app.example.org/articles/hello-world", excerpt: "Own excerpt.", author: "Writer", included: true });
  });

  it("strips Markdown and clips when there is no excerpt", () => {
    expect(stripMarkdown("# Heading\n\nSome **bold** [link](https://x.org) ![img](https://x.org/a.png)")).toBe("Heading Some bold link");
    expect(articleExcerpt(art({ content: "word ".repeat(100) }), 50).length).toBeLessThanOrEqual(50);
  });
});

describe("events", () => {
  const from = T("2026-12-10T00:00:00Z");
  const guild = "123456789012345678";
  const ev = (id: string, start: string, o: object = {}) => ({ id, name: `Event ${id}`, status: 1, scheduled_start_time: start, ...o });

  it("keeps scheduled events inside the window, soonest first, with a Discord link", () => {
    const out = selectEvents(
      [ev("200000000000000002", "2026-12-20T18:00:00Z"), ev("200000000000000001", "2026-12-12T18:00:00Z"), ev("200000000000000003", "2027-03-01T18:00:00Z"), ev("200000000000000004", "2026-12-11T00:00:00Z", { status: 2 }), ev("200000000000000005", "2026-12-01T00:00:00Z")],
      from,
      45,
      guild,
    );
    expect(out.map((e) => e.id)).toEqual(["discord:200000000000000001", "discord:200000000000000002"]);
    expect(out[0]!.url).toBe(`https://discord.com/events/${guild}/200000000000000001`);
  });

  it("lists nothing when there are no events", () => {
    expect(selectEvents([], from, 45, guild)).toEqual([]);
  });
});

describe("spotlights", () => {
  const sub = (o: Partial<SpotlightRow> = {}): SpotlightRow => ({ id: 1, nomineeName: "Nominee", city: "Town", pitch: "Did good things.", links: ["https://example.org", "http://insecure.example"], photoUrl: "https://blob.example/a.jpg", consent: true, status: "SHORTLISTED", ...o });

  it("offers only consented, shortlisted or featured submissions not used before", () => {
    const rows = [sub({ id: 1 }), sub({ id: 2, consent: false }), sub({ id: 3, status: "NEW" }), sub({ id: 4, status: "FEATURED" }), sub({ id: 5, status: "DECLINED" }), sub({ id: 6 })];
    expect(eligibleSpotlights(rows, new Set([6])).map((r) => r.id)).toEqual([1, 4]);
    expect(memberCandidates(rows, new Set()).map((c) => c.id)).toEqual([1, 4, 6]);
  });

  it("builds the section with https links only", () => {
    expect(memberSection(sub())).toMatchObject({ enabled: true, submissionId: 1, name: "Nominee", links: ["https://example.org"], photoUrl: "https://blob.example/a.jpg" });
  });

  it("city section needs a known city", () => {
    const options = cityOptions([{ key: "k1", name: "Zed" }, { key: "k2", name: "Alpha" }, { key: "k1", name: "Dup" }]);
    expect(options.map((o) => o.name)).toEqual(["Alpha", "Zed"]);
    expect(citySection("k2", "notes", options)).toMatchObject({ cityKey: "k2", name: "Alpha", notes: "notes" });
    expect(citySection("nope", "", options)).toBeNull();
  });
});
