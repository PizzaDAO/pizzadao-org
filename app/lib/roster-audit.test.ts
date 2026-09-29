import { describe, it, expect, vi } from "vitest";

vi.mock("@/app/lib/db", () => ({ prisma: { attendanceSummary: { findMany: vi.fn() } } }));
vi.mock("@/app/lib/sheets/members-list", () => ({ fetchAllMembers: vi.fn() }));

import { computeRosterAudit, parseCrewBreakdown, type AuditMember, type AuditSummary } from "./roster-audit";

const NOW = new Date("2026-09-01T00:00:00.000Z");
const RECENT = "2026-08-15T00:00:00.000Z";
const OLD = "2025-12-01T00:00:00.000Z"; // > 6 months before NOW

function member(id: string, crews: string[], discordId = `d${id}`): AuditMember {
  return { id, name: `Member ${id}`, crews, discordId };
}
function summary(discordId: string, crewBreakdown: unknown, memberId: string | null = null): AuditSummary {
  return { discordId, memberId, crewBreakdown };
}

// Establishes which crews have attendance tracking at all.
const tracker = summary("dtracker", {
  ops: { crewLabel: "Ops", count: 1, lastAttended: RECENT },
  biz_dev: { crewLabel: "Biz Dev", count: 1, lastAttended: RECENT },
  design_art: { crewLabel: "Design & Art", count: 1, lastAttended: RECENT },
});

describe("computeRosterAudit", () => {
  it("reports no changes when roster matches attendance", () => {
    const res = computeRosterAudit(
      [member("1", ["Ops", "Biz Dev"])],
      [tracker, summary("d1", {
        ops: { crewLabel: "Ops", count: 5, lastAttended: RECENT },
        biz_dev: { crewLabel: "Biz Dev", count: 4, lastAttended: RECENT },
        community_call: { crewLabel: "Community Call", count: 20, lastAttended: RECENT },
      })],
      NOW
    );
    expect(res.missing).toEqual([]);
    expect(res.inactive).toEqual([]);
    expect(res.healthyCount).toBe(2);
  });

  it("suggests additions for 3+ calls to a crew not on the roster", () => {
    const res = computeRosterAudit(
      [member("1", ["Ops"])],
      [tracker, summary("d1", {
        ops: { crewLabel: "Ops", count: 5, lastAttended: RECENT },
        biz_dev: { crewLabel: "Biz Dev", count: 3, lastAttended: RECENT },
        design_art: { crewLabel: "Design & Art", count: 2, lastAttended: RECENT }, // below threshold
        community_call: { crewLabel: "Community Call", count: 50, lastAttended: RECENT }, // excluded
      })],
      NOW
    );
    expect(res.missing).toEqual([
      { memberId: "1", name: "Member 1", crewId: "biz_dev", crewLabel: "Biz Dev", attendanceCount: 3, lastAttendedDate: RECENT },
    ]);
    expect(res.inactive).toEqual([]);
  });

  it("suggests removals for zero attendance and for stale attendance", () => {
    const res = computeRosterAudit(
      [member("1", ["Ops", "Biz Dev"]), member("2", ["Ops"])],
      [tracker, summary("d1", { ops: { crewLabel: "Ops", count: 7, lastAttended: OLD } })],
      NOW
    );
    // Member 1: Ops is stale, Biz Dev has no attendance. Member 2: no summary at all.
    expect(res.inactive.map((m) => [m.memberId, m.crewId, m.attendanceCount])).toEqual([
      ["1", "biz_dev", 0],
      ["1", "ops", 7],
      ["2", "ops", 0],
    ]);
    expect(res.healthyCount).toBe(0);
  });

  it("normalizes roster labels the same way as crew-mappings slugs", () => {
    const res = computeRosterAudit(
      [member("1", ["Design & Art", "  biz-dev "])],
      [tracker, summary("d1", {
        design_art: { crewLabel: "Design & Art", count: 4, lastAttended: RECENT },
        biz_dev: { crewLabel: "Biz Dev", count: 4, lastAttended: RECENT },
      })],
      NOW
    );
    expect(res.missing).toEqual([]);
    expect(res.inactive).toEqual([]);
    expect(res.healthyCount).toBe(2);
  });

  it("does not flag crews that have no attendance tracking at all", () => {
    const res = computeRosterAudit([member("1", ["Ops", "Untracked Crew"])], [tracker], NOW);
    expect(res.inactive.map((m) => m.crewId)).toEqual(["ops"]);
    expect(res.untrackedCount).toBe(1);
  });

  it("falls back to memberId when the member has no Discord ID", () => {
    const res = computeRosterAudit(
      [member("1", [], ""), member("2", ["Ops"], "")],
      [tracker, summary("UNKNOWN", { ops: { crewLabel: "Ops", count: 3, lastAttended: RECENT } }, "1")],
      NOW
    );
    expect(res.missing.map((m) => [m.memberId, m.crewId])).toEqual([["1", "ops"]]);
    // Member 2 has neither a Discord ID nor a memberId match: unknown, not inactive.
    expect(res.inactive).toEqual([]);
  });

  describe("malformed data", () => {
    it("skips members whose crewBreakdown is not an object instead of flagging every crew", () => {
      for (const bad of [null, "oops", 42, ["ops"]]) {
        const res = computeRosterAudit([member("1", ["Ops"])], [tracker, summary("d1", bad)], NOW);
        expect(res.inactive).toEqual([]);
        expect(res.missing).toEqual([]);
        expect(res.skippedMembers).toBe(1);
      }
    });

    it("ignores malformed breakdown entries and bad dates", () => {
      const res = computeRosterAudit(
        [member("1", ["Ops"])],
        [tracker, summary("d1", {
          ops: { crewLabel: "Ops", count: 4, lastAttended: "not-a-date" },
          biz_dev: { crewLabel: "Biz Dev", count: "9" },
          design_art: null,
          "": { count: 10 },
        })],
        NOW
      );
      expect(res.healthyCount).toBe(1); // ops counted, invalid date not treated as stale
      expect(res.missing).toEqual([]);
    });

    it("ignores UNRESOLVED summaries, malformed members, blank crew tokens and duplicate rows", () => {
      const res = computeRosterAudit(
        [
          member("1", ["Ops", "", "ops"]),
          member("1", ["Biz Dev"]), // duplicate member row: first wins
          { id: "", name: "No id", crews: ["Ops"] },
          { id: "3", name: "Bad crews", crews: "Ops" as unknown as string[], discordId: "d3" },
        ],
        [
          tracker,
          summary("UNRESOLVED:someone", { ops: { crewLabel: "Ops", count: 99 } }),
          summary("d1", { ops: { crewLabel: "Ops", count: 3, lastAttended: RECENT } }),
        ],
        NOW
      );
      expect(res.healthyCount).toBe(1);
      expect(res.inactive).toEqual([]);
      expect(res.missing).toEqual([]);
    });
  });
});

describe("parseCrewBreakdown", () => {
  it("returns null for non-objects and normalizes keys", () => {
    expect(parseCrewBreakdown(undefined)).toBeNull();
    expect(parseCrewBreakdown([])).toBeNull();
    expect(parseCrewBreakdown({ "Biz Dev": { count: 2 } })).toEqual({
      biz_dev: { crewLabel: "biz_dev", count: 2, lastAttended: null },
    });
  });
});
