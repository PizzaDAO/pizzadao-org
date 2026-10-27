import { describe, it, expect, vi, beforeEach } from "vitest";

const attFind = vi.fn();
const linkFindFirst = vi.fn();
const linkUpdateMany = vi.fn();
const queryRaw = vi.fn();
vi.mock("@/app/lib/db", () => ({
  prisma: {
    callAttendance: { findFirst: (...a: unknown[]) => attFind(...a), findMany: vi.fn() },
    $queryRaw: (...a: unknown[]) => queryRaw(...a),
    poapMintLink: {
      findFirst: (...a: unknown[]) => linkFindFirst(...a),
      updateMany: (...a: unknown[]) => linkUpdateMany(...a),
    },
  },
}));

import { claimActivationCode, claimPoap, dayKey, isAllowedMintLink, isValidDayKey, parseMintLinks } from "./poap-claims";
import { pickNextMission } from "./next-mission";

describe("mint link parsing", () => {
  it("accepts https poap hosts only", () => {
    expect(isAllowedMintLink("https://poap.xyz/claim/abc123")).toBe(true);
    expect(isAllowedMintLink("https://app.poap.xyz/claim/abc")).toBe(true);
    expect(isAllowedMintLink("https://poap.website/claim/abc")).toBe(false);
    expect(isAllowedMintLink("http://poap.xyz/claim/abc")).toBe(false);
    expect(isAllowedMintLink("https://evil.com/poap.xyz")).toBe(false);
    expect(isAllowedMintLink("https://notpoap.xyz/claim/abc")).toBe(false);
    expect(isAllowedMintLink("javascript:alert(1)")).toBe(false);
  });
  it("splits, dedupes and flags invalid", () => {
    const r = parseMintLinks("https://poap.xyz/claim/a\nhttps://poap.xyz/claim/a, https://poap.xyz/claim/b nope");
    expect(r.valid).toEqual(["https://poap.xyz/claim/a", "https://poap.xyz/claim/b"]);
    expect(r.invalid).toEqual(["nope"]);
  });
});

describe("helpers", () => {
  it("day keys", () => {
    expect(dayKey(new Date("2026-10-29T23:59:00Z"))).toBe("2026-10-29");
    expect(isValidDayKey("2026-10-29")).toBe(true);
    expect(isValidDayKey("2026-13-40")).toBe(false);
    expect(isValidDayKey("tomorrow")).toBe(false);
  });
  it("activation code fits the allowed pattern", () => {
    expect(claimActivationCode("Community_Call", "2026-10-29")).toMatch(/^[a-z0-9_]{1,48}$/);
  });
});

describe("claimPoap", () => {
  beforeEach(() => {
    attFind.mockReset();
    linkFindFirst.mockReset();
    linkUpdateMany.mockReset();
    queryRaw.mockReset();
  });

  it("refuses members who did not attend", async () => {
    attFind.mockResolvedValue(null);
    expect(await claimPoap("1", "ops", "2026-10-29")).toEqual({ ok: false, reason: "not_attended" });
    expect(linkUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects a malformed day", async () => {
    expect(await claimPoap("1", "ops", "bad")).toEqual({ ok: false, reason: "invalid" });
  });

  it("returns the existing link without claiming another", async () => {
    attFind.mockResolvedValue({ id: 1 });
    linkFindFirst.mockResolvedValueOnce({ link: "https://poap.xyz/claim/mine" });
    expect(await claimPoap("1", "ops", "2026-10-29")).toEqual({ ok: true, link: "https://poap.xyz/claim/mine", alreadyClaimed: true });
    expect(linkUpdateMany).not.toHaveBeenCalled();
  });

  it("claims one unused link in a single statement", async () => {
    attFind.mockResolvedValue({ id: 1 });
    linkFindFirst.mockResolvedValueOnce(null);
    queryRaw.mockResolvedValue([{ link: "https://poap.xyz/claim/x" }]);
    expect(await claimPoap("1", "ops", "2026-10-29")).toEqual({ ok: true, link: "https://poap.xyz/claim/x", alreadyClaimed: false });
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it("returns the member's own link when a parallel double-click hits the unique index", async () => {
    attFind.mockResolvedValue({ id: 1 });
    linkFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ link: "https://poap.xyz/claim/mine" });
    queryRaw.mockRejectedValue(new Error("duplicate key value violates unique constraint (23505)"));
    expect(await claimPoap("1", "ops", "2026-10-29")).toEqual({ ok: true, link: "https://poap.xyz/claim/mine", alreadyClaimed: true });
  });

  it("reports none_left on an empty pool", async () => {
    attFind.mockResolvedValue({ id: 1 });
    linkFindFirst.mockResolvedValue(null);
    queryRaw.mockResolvedValue([]);
    expect(await claimPoap("1", "ops", "2026-10-29")).toEqual({ ok: false, reason: "none_left" });
  });
});

describe("pickNextMission", () => {
  const m = (id: number, index: number, status?: string) => ({ id, index, title: `M${id}`, progress: status ? { status } : null });
  it("skips done and pending, picks rejected or untouched at/above current level", () => {
    const overview = {
      currentLevel: 2,
      levels: [
        { level: 1, missions: [m(1, 1)] },
        { level: 2, missions: [m(2, 1, "APPROVED"), m(3, 2, "PENDING"), m(4, 3, "REJECTED")] },
        { level: 3, missions: [m(5, 1)] },
      ],
    } as never;
    expect(pickNextMission(overview)).toEqual({ level: 2, id: 4, title: "M4" });
  });
  it("moves to the next level and returns null when nothing is left", () => {
    expect(pickNextMission({ currentLevel: 1, levels: [{ level: 1, missions: [m(1, 1, "APPROVED")] }, { level: 2, missions: [m(2, 1)] }] } as never)?.id).toBe(2);
    expect(pickNextMission({ currentLevel: 1, levels: [{ level: 1, missions: [m(1, 1, "APPROVED")] }] } as never)).toBeNull();
  });
});
