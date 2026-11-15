import { describe, it, expect } from "vitest";
import { pickNextMission } from "./next-mission";

type Overview = Parameters<typeof pickNextMission>[0];
const mission = (id: number, index: number, status?: string) => ({ id, index, title: `M${id}`, progress: status ? { status } : null });
const overview = (): Overview =>
    ({
        currentLevel: 2,
        levels: [
            { level: 0, missions: [mission(90, 0), mission(91, 1, "APPROVED"), mission(92, 2, "PENDING"), mission(93, 3, "REJECTED")] },
            { level: 2, missions: [mission(20, 0, "APPROVED"), mission(21, 1)] },
        ],
    }) as unknown as Overview;

describe("pickNextMission", () => {
    it("without a pinned mission: the first open mission at or above the current level", () => {
        expect(pickNextMission(overview())).toEqual({ level: 2, id: 21, title: "M21" });
    });
    it("prefers the pinned lane mission while it is open or was rejected", () => {
        expect(pickNextMission(overview(), 90)).toEqual({ level: 0, id: 90, title: "M90" });
        expect(pickNextMission(overview(), 93)).toEqual({ level: 0, id: 93, title: "M93" });
    });
    it("falls back to today's rule when the pinned mission is submitted, approved or unknown", () => {
        for (const id of [91, 92, 12345, null, undefined]) {
            expect(pickNextMission(overview(), id)).toEqual({ level: 2, id: 21, title: "M21" });
        }
    });
});
