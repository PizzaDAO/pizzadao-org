import { describe, expect, it } from "vitest";
import { hostMatchModeKey, statusBadgeClass } from "./outbox-format";

describe("outbox-format", () => {
    it("gives Failed, Sent and Uncertain different badges", () => {
        const classes = new Set(["FAILED", "SENT", "UNCERTAIN", "PENDING", "SKIPPED"].map(statusBadgeClass));
        expect(classes.size).toBe(5);
        expect(statusBadgeClass("FAILED")).toContain("text-tomato-readable");
    });
    it("maps the host-matching mode to a label key", () => {
        expect(hostMatchModeKey(1)).toBe("modeProfile");
        expect(hostMatchModeKey(2)).toBe("modeInvite");
        expect(hostMatchModeKey(3)).toBe("modeInvite");
    });
});
