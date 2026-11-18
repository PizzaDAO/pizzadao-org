import { describe, expect, it } from "vitest";
import { missionChangeToasts, QUEUE_TOAST } from "./live-updates";

const snap = (...ms: Array<[number, string, string | null]>) => ({
  levels: [{ missions: ms.map(([id, title, status]) => ({ id, title, progress: status ? { status } : null })) }],
});

describe("missionChangeToasts", () => {
  it("names an approved mission", () => {
    expect(missionChangeToasts(snap([1, "Join Discord", "PENDING"]), snap([1, "Join Discord", "APPROVED"]))).toEqual([
      { kind: "success", message: "Mission approved: Join Discord" },
    ]);
  });
  it("says a rejected submission needs changes", () => {
    expect(missionChangeToasts(snap([1, "A", "PENDING"]), snap([1, "A", "REJECTED"]))).toEqual([
      { kind: "info", message: "Mission needs changes" },
    ]);
  });
  it("is silent when nothing changed", () => {
    expect(missionChangeToasts(snap([1, "A", "APPROVED"]), snap([1, "A", "APPROVED"]))).toEqual([]);
  });
  it("reviewer copy", () => expect(QUEUE_TOAST).toBe("New mission submitted for review"));
});
