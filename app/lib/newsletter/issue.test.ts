// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  hasAnyRoleSafe: vi.fn(async (_id: string, _roles: readonly string[]) => false),
  isAdminDiscordId: vi.fn(async (_id: string) => false),
}));
vi.mock("@/app/lib/db", () => ({ prisma: {} }));
vi.mock("@/app/lib/auth-guards", () => ({ hasAnyRoleSafe: h.hasAnyRoleSafe, isAdminDiscordId: h.isAdminDiscordId }));

import { approvalBlockers, editData, hashOf, isApprover, periodFor, slugFor, type IssueState } from "./issue";
import { emptySections } from "./sections";
import { DEFAULT_XSPACE } from "./xspace";
import { fakeSettings } from "./fake-db";

const sections = () => {
  const s = emptySections();
  s.intro = "Hello.";
  return s;
};
const issue = (o: Partial<IssueState> = {}): IssueState => ({
  id: "i1",
  status: "draft",
  subject: "Subject",
  preheader: "",
  issueDate: new Date("2026-12-22T12:00:00Z"),
  xSpaceUrl: null,
  sections: sections(),
  sponsorNotified: false,
  contentHash: null,
  ...o,
});
const NOW = new Date("2026-12-15T00:00:00Z");
const ctx = { actor: "admin1", now: NOW, xSpace: DEFAULT_XSPACE };

beforeEach(() => {
  h.hasAnyRoleSafe.mockReset().mockResolvedValue(false);
  h.isAdminDiscordId.mockReset().mockResolvedValue(false);
});

describe("approval permissions", () => {
  it("with no approver roles saved, app admins may approve and others may not", async () => {
    h.isAdminDiscordId.mockResolvedValueOnce(true);
    expect(await isApprover("u1", fakeSettings() as never)).toBe(true);
    expect(await isApprover("u2", fakeSettings() as never)).toBe(false);
    expect(h.hasAnyRoleSafe).not.toHaveBeenCalled();
  });

  it("with roles saved, only holders of one of them may (the role id comes from settings)", async () => {
    h.hasAnyRoleSafe.mockImplementation(async (id, roles) => id === "holder" && roles.includes("111111111111111111"));
    const s = fakeSettings({ "newsletter.approverRoleIds": ["111111111111111111"] });
    expect(await isApprover("holder", s as never)).toBe(true);
    expect(await isApprover("other", s as never)).toBe(false);
    // An admin without the role is not an approver once roles are configured.
    h.isAdminDiscordId.mockResolvedValue(true);
    expect(await isApprover("other", s as never)).toBe(false);
  });

  it("unreadable or invalid settings: nobody", async () => {
    h.isAdminDiscordId.mockResolvedValue(true);
    expect(await isApprover("a", { ...fakeSettings(), readFailed: true } as never)).toBe(false);
    expect(await isApprover("a", { ...fakeSettings(), invalidKeys: ["newsletter.approverRoleIds"] } as never)).toBe(false);
  });
});

describe("approval rules and hash", () => {
  it("a draft with a subject and content has no blockers", () => {
    expect(approvalBlockers(issue())).toEqual([]);
  });

  it("blocks non-drafts, empty subject and empty content", () => {
    expect(approvalBlockers(issue({ status: "approved" }))[0]).toMatch(/Only a draft/);
    expect(approvalBlockers(issue({ subject: " " }))).toContain("The subject is empty.");
    expect(approvalBlockers(issue({ sections: emptySections() }))).toContain("The issue has no content.");
  });

  it("a featured sponsor must be marked as notified", () => {
    const s = sections();
    s.partner = { ...s.partner, enabled: true, name: "Sponsor" };
    expect(approvalBlockers(issue({ sections: s })).join(" ")).toMatch(/sponsor/i);
    expect(approvalBlockers(issue({ sections: s, sponsorNotified: true }))).toEqual([]);
    s.partner.enabled = false;
    expect(approvalBlockers(issue({ sections: s }))).toEqual([]);
  });

  it("the hash covers every reader-visible field and ignores key order", () => {
    const base = hashOf(issue());
    expect(hashOf(issue())).toBe(base);
    expect(hashOf(issue({ subject: "Other" }))).not.toBe(base);
    expect(hashOf(issue({ preheader: "x" }))).not.toBe(base);
    expect(hashOf(issue({ xSpaceUrl: "https://x.com/i/spaces/a" }))).not.toBe(base);
    expect(hashOf(issue({ issueDate: new Date("2026-12-23T12:00:00Z") }))).not.toBe(base);
    const edited = sections();
    edited.intro = "Hello!";
    expect(hashOf(issue({ sections: edited }))).not.toBe(base);
    const reordered = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(sections()).reverse())));
    expect(hashOf(issue({ sections: reordered }))).toBe(base);
  });
});

describe("edits invalidate approval", () => {
  it("editing an approved issue returns it to draft and clears the approval", () => {
    const approved = issue({ status: "approved", contentHash: "abc" });
    const { data, invalidated } = editData(approved, { subject: "New subject" }, ctx);
    expect(invalidated).toBe(true);
    expect(data).toMatchObject({ subject: "New subject", status: "draft", approvedBy: null, approvedAt: null, contentHash: null, sendAfter: null, editedBy: "admin1" });
  });

  it("editing a draft changes nothing about its status", () => {
    const { data, invalidated } = editData(issue(), { preheader: "p" }, ctx);
    expect(invalidated).toBe(false);
    expect(data.status).toBeUndefined();
    expect(data.contentHash).toBeUndefined();
  });

  it("changing the date rebuilds the X Space invite unless the block was edited in the same save", () => {
    const s = sections();
    s.xSpace = { enabled: true, headline: "old", detail: "old", url: null };
    const today = editData(issue({ sections: s }), { issueDate: new Date("2026-12-22T12:00:00Z") }, ctx);
    expect(today.data.sections!.xSpace.headline).toBe("old"); // same date: block untouched
    const moved = editData(issue({ sections: s }), { issueDate: new Date("2026-12-18T12:00:00Z") }, ctx);
    expect(moved.data.sections!.xSpace.headline).toBe("Join our X Space on Tuesday, December 22 at 4:20pm ET");
    expect(moved.data.sections!.xSpace.enabled).toBe(true);
    const custom = { ...s, xSpace: { ...s.xSpace, headline: "My own words" } };
    const kept = editData(issue({ sections: s }), { issueDate: new Date("2026-12-18T12:00:00Z"), sections: custom }, ctx);
    expect(kept.data.sections!.xSpace.headline).toBe("My own words");
  });

  it("a new Space link updates the block's link", () => {
    const s = sections();
    s.xSpace = { enabled: true, headline: "h", detail: "d", url: null };
    const r = editData(issue({ sections: s }), { xSpaceUrl: "https://x.com/i/spaces/new" }, ctx);
    expect(r.data.xSpaceUrl).toBe("https://x.com/i/spaces/new");
    expect(r.data.sections!.xSpace.url).toBe("https://x.com/i/spaces/new");
  });
});

describe("period and slug", () => {
  it("first issue looks back 31 days; later ones start where the last sent issue ended", () => {
    expect(periodFor(null, NOW).start.toISOString()).toBe("2026-11-14T00:00:00.000Z");
    const prev = new Date("2026-11-22T10:00:00Z");
    expect(periodFor(prev, NOW)).toEqual({ start: prev, end: NOW });
  });

  it("slug is the month, with a suffix when taken", () => {
    const d = new Date("2026-12-22T12:00:00Z");
    expect(slugFor(d, new Set())).toBe("2026-12");
    expect(slugFor(d, new Set(["2026-12"]))).toBe("2026-12-2");
    expect(slugFor(d, new Set(["2026-12", "2026-12-2"]))).toBe("2026-12-3");
  });
});
